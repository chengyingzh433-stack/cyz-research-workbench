import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,mkdir,unlink,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ProjectService} from '../../packages/project-service/src/project.ts';
import {startConversion,pollConversion,approveSample,listConversions,readConversion,reconcileConversion,type ConversionClient} from '../../packages/project-service/src/conversions.ts';
import {prepareTask} from '../../packages/project-service/src/tasks.ts';
import {listCandidates} from '../../packages/project-service/src/candidates.ts';
const services:ProjectService[]=[];
afterEach(()=>{for(const service of services.splice(0))service.close()});
async function setup(){
  const root=await mkdtemp(join(tmpdir(),'cyz 解析 '));const service=await ProjectService.create(root);services.push(service);
  const external=join(await mkdtemp(join(tmpdir(),'cyz PDF夹具 ')),'test.pdf');await writeFile(external,'%PDF synthetic transport fixture');
  const source=await service.importSource(external);const sourcePath=join(root,source.relpath);
  const requests:any[]=[];let offline=true,failSubmit=false;
  const client:ConversionClient={
    preflight:async()=>({offline}),pages:async()=>2,
    submit:async path=>{requests.push(JSON.parse(await readFile(path,'utf8')));if(failSubmit)throw new Error('response lost');return 'desk-'+requests.length},
    task:async id=>({id,status:'completed',source:sourcePath}),content:async()=> '# synthetic sample text',
    finalize:async(_id,_source,output)=>{await mkdir(output,{recursive:true});await writeFile(join(output,'paper.md'),'# canonical synthetic paper');await writeFile(join(output,'source_map.json'),JSON.stringify({pdf_sha256:source.sha256,pages:[{pdf_page:1},{pdf_page:2}]}))},
  };
  return {root,service,source,client,requests,setOffline:(v:boolean)=>offline=v,setFailSubmit:()=>failSubmit=true};
}
it('requires sample review before full conversion and never submits twice',async()=>{
  const {service,source,client,requests}=await setup();
  const job=await startConversion(service,source.id,client);expect(job.status).toBe('sample_running');expect(requests[0].options.pages).toBe('1-2');
  expect((await startConversion(service,source.id,client)).id).toBe(job.id);expect(requests).toHaveLength(1);
  expect((await pollConversion(service,job.id,client)).status).toBe('sample_review');expect(requests).toHaveLength(1);
  expect((await approveSample(service,job.id,client)).status).toBe('full_running');expect(requests[1].options).not.toHaveProperty('pages');
  expect((await pollConversion(service,job.id,client)).status).toBe('completed');expect(requests).toHaveLength(2);
  const cached=await startConversion(service,source.id,client);expect(cached.status).toBe('completed');expect(requests).toHaveLength(2);
});
it('rejects changed sample text before reading or approving full conversion',async()=>{
  const {root,service,source,client,requests}=await setup();
  const job=await startConversion(service,source.id,client);await pollConversion(service,job.id,client);
  await writeFile(join(root,'.cyz/conversions',job.id,'sample.md'),'changed sample');
  expect(()=>readConversion(service,job.id)).toThrow('CACHE_INTEGRITY_ERROR');
  await expect(approveSample(service,job.id,client)).rejects.toThrow('CACHE_INTEGRITY_ERROR');
  expect(requests).toHaveLength(1);
});
it.each(['changed','missing'])('rejects %s cached image assets',async(mode)=>{
  const {root,service,source,client}=await setup();const finalize=client.finalize;
  client.finalize=async(id,path,output)=>{await finalize(id,path,output);await mkdir(join(output,'assets'));await writeFile(join(output,'assets/figure.jpg'),'original image bytes')};
  const job=await startConversion(service,source.id,client);await pollConversion(service,job.id,client);await approveSample(service,job.id,client);await pollConversion(service,job.id,client);
  expect(readConversion(service,job.id).scope).toBe('full');
  const asset=join(root,'.cyz/conversions',job.id,'cache/assets/figure.jpg');
  if(mode==='changed')await writeFile(asset,'different image');else await unlink(asset);
  expect(()=>readConversion(service,job.id)).toThrow('CACHE_INTEGRITY_ERROR');
});
it('refuses a linked cache asset directory before marking conversion complete',async()=>{
  const {service,source,client}=await setup();const finalize=client.finalize;
  const external=await mkdtemp(join(tmpdir(),'cyz 外部资产 '));await writeFile(join(external,'figure.jpg'),'external');
  client.finalize=async(id,path,output)=>{await finalize(id,path,output);await symlink(external,join(output,'assets'),'junction')};
  const job=await startConversion(service,source.id,client);await pollConversion(service,job.id,client);await approveSample(service,job.id,client);
  await expect(pollConversion(service,job.id,client)).rejects.toThrow('INVALID_PATH');
  expect(listConversions(service)[0].status).toBe('finalizing');
});
it('refuses online operation without submitting the source',async()=>{
  const {service,source,client,requests,setOffline}=await setup();setOffline(false);
  await expect(startConversion(service,source.id,client)).rejects.toThrow('MINERU_OFFLINE_REQUIRED');expect(requests).toHaveLength(0);
});
it('preserves uncertain submissions instead of resubmitting after a lost response',async()=>{
  const {service,source,client,requests,setFailSubmit}=await setup();setFailSubmit();
  await expect(startConversion(service,source.id,client)).rejects.toThrow('CONVERSION_SUBMISSION_UNKNOWN');
  expect(listConversions(service)).toMatchObject([{status:'reconciling'}]);
  await startConversion(service,source.id,client);expect(requests).toHaveLength(1);
});
it.each([0,1,2])('reconciles only a unique owned submission (%i matches) without submitting again',async(count)=>{
  const {service,source,client,requests,setFailSubmit}=await setup();setFailSubmit();
  await expect(startConversion(service,source.id,client)).rejects.toThrow('CONVERSION_SUBMISSION_UNKNOWN');
  const job=listConversions(service)[0],request=requests[0];
  client.submissions=async()=>Array.from({length:count},(_,i)=>({id:'found-'+i,source:request.files[0],outputRoot:request.outputRoot,options:request.options}));
  const result=await reconcileConversion(service,job.id,client);
  expect(result.status).toBe(count===1?'sample_running':'reconciling');
  if(count===1)expect(result.taskId).toBe('found-0');
  expect(requests).toHaveLength(1);
});
it('does not reconcile another output root or different parsing options',async()=>{
  const {service,source,client,requests,setFailSubmit}=await setup();setFailSubmit();
  await expect(startConversion(service,source.id,client)).rejects.toThrow('CONVERSION_SUBMISSION_UNKNOWN');
  const job=listConversions(service)[0],request=requests[0];
  client.submissions=async()=>[
    {id:'wrong-root',source:request.files[0],outputRoot:request.outputRoot+'-other',options:request.options},
    {id:'wrong-options',source:request.files[0],outputRoot:request.outputRoot,options:{...request.options,pages:''}},
  ];
  expect((await reconcileConversion(service,job.id,client)).status).toBe('reconciling');expect(requests).toHaveLength(1);
});
it('recovers a lost full submission without mistaking the sample for full text',async()=>{
  const {service,source,client,requests,setFailSubmit}=await setup();
  const job=await startConversion(service,source.id,client);await pollConversion(service,job.id,client);setFailSubmit();
  await expect(approveSample(service,job.id,client)).rejects.toThrow('CONVERSION_SUBMISSION_UNKNOWN');
  const request=requests[1];client.submissions=async()=>[{id:'full-existing',source:request.files[0],outputRoot:request.outputRoot,options:{...request.options,pages:''}}];
  expect(await reconcileConversion(service,job.id,client)).toMatchObject({status:'full_running',taskId:'full-existing',sampleTaskId:'desk-1'});
  expect(requests).toHaveLength(2);
});
it('never replaces an already registered task ID during reconciliation',async()=>{
  const {service,source,client,requests}=await setup();const job=await startConversion(service,source.id,client);
  service.db.prepare("UPDATE conversions SET status='reconciling' WHERE id=?").run(job.id);
  const request=requests[0];client.submissions=async()=>[{id:'different-id',source:request.files[0],outputRoot:request.outputRoot,options:request.options}];
  expect(await reconcileConversion(service,job.id,client)).toMatchObject({status:'reconciling',taskId:'desk-1'});
});
it('does not silently certify a legacy full cache with no file inventory',async()=>{
  const {service,source,client}=await setup();const job=await startConversion(service,source.id,client);
  await pollConversion(service,job.id,client);await approveSample(service,job.id,client);await pollConversion(service,job.id,client);
  service.db.prepare('DELETE FROM conversion_files WHERE conversionId=?').run(job.id);
  expect(()=>readConversion(service,job.id)).toThrow('CACHE_VERIFICATION_REQUIRED');
});
it('does not accept a result belonging to another source or task',async()=>{
  const {service,source,client}=await setup();const job=await startConversion(service,source.id,client);
  client.task=async id=>({id,status:'completed',source:'C:/not-this-source.pdf'});
  await expect(pollConversion(service,job.id,client)).rejects.toThrow('CONVERSION_IDENTITY_MISMATCH');
  expect(listConversions(service)).toMatchObject([{status:'reconciling'}]);
});
it('makes verified parsed text available to the research workspace with source identity',async()=>{
  const {service,source,client}=await setup();const job=await startConversion(service,source.id,client);
  await pollConversion(service,job.id,client);await approveSample(service,job.id,client);await pollConversion(service,job.id,client);
  const research=await prepareTask(service,'S3','阅读已有解析');
  const context=JSON.parse(await readFile(join(research.cwd,'CYZ_RUN_CONTEXT.json'),'utf8'));
  expect(context.sources[0].readingPath).toBeDefined();expect(context.sources[0].sha256).toBe(source.sha256);
  expect(await readFile(join(research.cwd,context.sources[0].readingPath),'utf8')).toContain('canonical synthetic paper');
  expect(context.sources[0].readingScope).toContain('image assets and original PDF are not copied');
  expect(context.files).toContainEqual({relpath:context.sources[0].readingPath,sha256:createHash('sha256').update('# canonical synthetic paper').digest('hex'),baseVersionId:null});
  service.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(research.taskId);
  expect(await listCandidates(service,research.taskId)).toEqual([]);
});
it('refuses modified parsed text instead of silently reusing it',async()=>{
  const {root,service,source,client,requests}=await setup();const job=await startConversion(service,source.id,client);
  await pollConversion(service,job.id,client);await approveSample(service,job.id,client);await pollConversion(service,job.id,client);
  await writeFile(join(root,'.cyz/conversions',job.id,'cache/paper.md'),'changed');
  expect(()=>readConversion(service,job.id)).toThrow('CACHE_INTEGRITY_ERROR');
  await expect(startConversion(service,source.id,client)).rejects.toThrow('CACHE_INTEGRITY_ERROR');expect(requests).toHaveLength(2);
  await expect(prepareTask(service,'S3','不得读取被修改的缓存')).rejects.toThrow('CACHE_INTEGRITY_ERROR');
  expect(service.snapshot().tasks).toMatchObject([{status:'failed'}]);
});
