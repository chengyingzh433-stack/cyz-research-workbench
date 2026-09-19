import {createHash} from 'node:crypto';
import {readFile,readdir,stat} from 'node:fs/promises';
import type {ProjectService} from './project.ts';
import {projectPath} from './path-policy.ts';
type Base={relpath:string;sha256:string;baseVersionId:string|null};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function context(service:ProjectService,taskId:string){
  const task=service.db.prepare('SELECT status,runId FROM tasks WHERE id=?').get(taskId) as {status:string;runId:string}|undefined;
  if(!task)throw new Error('TASK_NOT_FOUND');if(task.status!=='completed')throw new Error('TASK_NOT_COMPLETED');
  const cwd=projectPath(service.root,`.cyz/runs/${task.runId}/workspace`,true);
  const saved=JSON.parse(await readFile(projectPath(service.root,`.cyz/runs/${task.runId}/context.json`,true),'utf8'));
  if(saved.taskId!==taskId||saved.projectId!==service.metadata.projectId||!Array.isArray(saved.files))throw new Error('RUN_CONTEXT_INVALID');
  return {cwd,files:saved.files as Base[]};
}
async function readCandidate(cwd:string,relpath:string){
  const path=projectPath(cwd,relpath);
  if(!relpath.endsWith('.md'))throw new Error('CANDIDATE_FORMAT_UNSUPPORTED');
  if((await stat(path)).size>10*1024*1024)throw new Error('CANDIDATE_TOO_LARGE');
  const bytes=await readFile(path);if(bytes.length>10*1024*1024)throw new Error('CANDIDATE_TOO_LARGE');
  return {relpath,sha256:hash(bytes),text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),bytes:bytes.length};
}
export async function listCandidates(service:ProjectService,taskId:string){
  const {cwd,files}=await context(service,taskId);
  const result:Awaited<ReturnType<typeof readCandidate>>[]=[];let visited=0,total=0;
  async function scan(prefix:string,depth:number){
    if(depth>8)throw new Error('CANDIDATE_TREE_TOO_DEEP');
    for(const entry of await readdir(prefix?projectPath(cwd,prefix):cwd,{withFileTypes:true})){
      if(++visited>1000)throw new Error('TOO_MANY_CANDIDATES');
      if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
      const relpath=prefix?prefix+'/'+entry.name:entry.name;
      if(entry.isDirectory())await scan(relpath,depth+1);
      else if(entry.isFile()&&relpath.endsWith('.md')){
        const item=await readCandidate(cwd,relpath);total+=item.bytes;if(total>20*1024*1024)throw new Error('CANDIDATE_TOTAL_TOO_LARGE');
        if(files.find(f=>f.relpath===relpath)?.sha256!==item.sha256)result.push(item);
      }
    }
  }
  await scan('',0);return result;
}
export async function publishCandidate(service:ProjectService,taskId:string,relpath:string,expectedHash:string){
  const {cwd,files}=await context(service,taskId);
  const item=await readCandidate(cwd,relpath);
  if(item.sha256!==expectedHash)throw new Error('CANDIDATE_CHANGED');
  const base=files.find(f=>f.relpath===relpath);
  if(base?.sha256===item.sha256)throw new Error('CANDIDATE_UNCHANGED');
  const result=await service.saveArtifact(relpath,item.text,base?.baseVersionId??null);
  service.emit('candidate.reviewed',{taskId,relpath,sha256:item.sha256,versionId:result.versionId,status:result.status});
  return result;
}
