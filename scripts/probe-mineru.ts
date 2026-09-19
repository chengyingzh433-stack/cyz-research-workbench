import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DeskClient,findDesk} from '../packages/mineru-adapter/src/client.ts';
import {ProjectService} from '../packages/project-service/src/project.ts';
import {startConversion,pollConversion,approveSample,readConversion} from '../packages/project-service/src/conversions.ts';
const client=new DeskClient(await findDesk());
const approval=process.argv.includes('--approve');
await mkdir('.tmp',{recursive:true});
let project:ProjectService|undefined;
try{
  console.log('MINERU_PREFLIGHT_STARTED');await client.preflight();console.log('MINERU_PREFLIGHT_PASSED');
  let id:string;
  if(approval){const previous=JSON.parse(await readFile('.tmp/mineru-live-state.json','utf8'));project=await ProjectService.open(previous.root);id=previous.id;await approveSample(project,id,client)}
  else{
    project=await ProjectService.create(await mkdtemp(join(tmpdir(),'cyz MinerU 实测 ')));
    const source=await project.importSource(join(client.root,'examples','selftest.pdf'));
    const job=await startConversion(project,source.id,client);id=job.id;
    await writeFile('.tmp/mineru-live-state.json',JSON.stringify({root:project.root,id,sourceHash:source.sha256}));
  }
  const deadline=Date.now()+15*60*1000;let status='';
  while(Date.now()<deadline){
    const job=await pollConversion(project,id,client);if(job.status!==status){status=job.status;console.log('CONVERSION_STATUS '+status)}
    if(status==='sample_review'||status==='completed')break;
    if(!['sample_running','full_running','finalizing'].includes(status))throw new Error('CONVERSION_NOT_RUNNING');
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  const result=readConversion(project,id);
  await writeFile('.tmp/mineru-live-preview.md',result.text);
  console.log(JSON.stringify({scope:result.scope,containsExpectedText:result.text.includes('Physics Education'),pages:result.pages.length,preview:'.tmp/mineru-live-preview.md'}));
  if(approval){
    const report={recordedAt:new Date().toISOString(),scope:result.scope,source:'bundled synthetic two-page PDF',pages:result.pages.length,containsExpectedText:result.text.includes('Physics Education'),status:'completed',sampleApproval:'main agent visual/text inspection before --approve',cloudUploads:0};
    await writeFile('docs/acceptance/mineru-live-probe.json',JSON.stringify(report,null,2)+'\n');
    if(result.scope!=='full'||result.pages.length!==2||!report.containsExpectedText)process.exitCode=1;
  }
}finally{project?.close()}
