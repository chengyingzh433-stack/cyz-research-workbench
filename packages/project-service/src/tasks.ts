import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import type {ProjectService} from './project.ts';
import {projectPath} from './path-policy.ts';
import {listConversions,readConversion} from './conversions.ts';

export async function prepareTask(service:ProjectService,stage:string,objective:string){
  if(!/^S[0-8]$/.test(stage))throw new Error('INVALID_STAGE');
  if(!objective.trim()||objective.length>30000)throw new Error('INVALID_OBJECTIVE');
  const taskId=randomUUID(),runId=randomUUID();
  // Reserve synchronously before copying, including for concurrent IPC/API callers.
  service.db.transaction(()=>{
    if(service.db.prepare("SELECT id FROM tasks WHERE status IN ('queued','running','waiting_user','stopping','reconciling') LIMIT 1").get())throw new Error('TASK_NEEDS_ATTENTION');
    service.db.prepare('INSERT INTO tasks(id,stageId,objective,status,runId,createdAt) VALUES(?,?,?,?,?,?)').run(taskId,stage,objective,'queued',runId,new Date().toISOString());
  })();
  try{
    const cwd=projectPath(service.root,`.cyz/runs/${runId}/workspace`,true);
    await mkdir(cwd,{recursive:true});
    let total=0;
    const files:{relpath:string;sha256:string;baseVersionId:string|null}[]=[];
    const record=(relpath:string,bytes:Buffer,baseVersionId:string|null)=>files.push({relpath,sha256:createHash('sha256').update(bytes).digest('hex'),baseVersionId});
    const artifacts=service.snapshot().artifacts.filter(a=>a.currentVersionId!==null);
    const registered=new Set(artifacts.map(a=>a.relpath));
    for(const entry of await readdir(service.root,{withFileTypes:true})){
      if(!entry.isFile()||!entry.name.endsWith('.md'))continue;
      if(registered.has(entry.name))continue;
      const path=projectPath(service.root,entry.name);
      if((await stat(path)).size>2*1024*1024)throw new Error('CONTEXT_FILE_TOO_LARGE');
      const bytes=await readFile(path);
      if(bytes.length>2*1024*1024)throw new Error('CONTEXT_FILE_TOO_LARGE');
      total+=bytes.length;if(total>10*1024*1024)throw new Error('CONTEXT_TOTAL_TOO_LARGE');
      await writeFile(join(cwd,entry.name),bytes,{flag:'wx'});
      record(entry.name,bytes,null);
    }
    for(const artifact of artifacts){
      const bytes=Buffer.from(service.readVersion(artifact.currentVersionId!));
      total+=bytes.length;if(total>10*1024*1024)throw new Error('CONTEXT_TOTAL_TOO_LARGE');
      const target=projectPath(cwd,artifact.relpath);
      await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
      record(artifact.relpath,bytes,artifact.currentVersionId);
    }
    const conversions=listConversions(service);
    const sources=[];
    for(const source of service.snapshot().sources){
      const conversion=conversions.filter(job=>job.sourceId===source.id&&job.status==='completed').at(-1);
      if(!conversion){sources.push(source);continue}
      const reading=readConversion(service,conversion.id);
      const bytes=Buffer.from(reading.text);
      total+=bytes.length;if(total>10*1024*1024)throw new Error('CONTEXT_TOTAL_TOO_LARGE');
      const readingPath=`02-文献/解析阅读/${source.id}/paper.md`;
      const target=projectPath(cwd,readingPath,true);
      await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
      record(readingPath,bytes,null);
      sources.push({...source,readingPath,conversionId:conversion.id,readingScope:'Parsed text only; image assets and original PDF are not copied. Verify figures and quotations against the original.'});
    }
    const context=JSON.stringify({stage,projectId:service.metadata.projectId,taskId,runId,files,contextScope:'Root Markdown, saved artifact versions, and integrity-checked parsed text where a source has readingPath. Other sources are catalog metadata only. Image assets and original PDFs are not included.',artifacts:artifacts.map(a=>({relpath:a.relpath,baseVersionId:a.currentVersionId})),sources},null,2);
    await writeFile(projectPath(service.root,`.cyz/runs/${runId}/context.json`,true),context,{flag:'wx'});
    await writeFile(join(cwd,'CYZ_RUN_CONTEXT.json'),context,{flag:'wx'});
    service.emit('message.user',{taskId,text:objective});
    return {taskId,runId,cwd};
  }catch(error){
    service.db.prepare("UPDATE tasks SET status='failed' WHERE id=?").run(taskId);
    service.emit('task.status.changed',{taskId,status:'failed',reason:'CONTEXT_PREPARATION_FAILED'});
    // Preserve partial run for diagnosis. Never treat it as a formal artifact.
    throw error;
  }
}
