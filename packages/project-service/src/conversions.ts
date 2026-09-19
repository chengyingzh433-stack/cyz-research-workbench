import type {ProjectService} from './project.ts';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {projectPath} from './path-policy.ts';
export interface ConversionClient{
  preflight():Promise<{offline:boolean}>;
  pages(source:string):Promise<number>;
  submit(requestFile:string):Promise<string>;
  task(id:string):Promise<{id:string;status:string;source:string}>;
  content(id:string):Promise<string>;
  finalize(id:string,source:string,output:string):Promise<void>;
}
export type Conversion={id:string;sourceId:string;status:string;taskId:string|null;sampleTaskId:string|null;paperHash:string|null;mapHash:string|null};
const busy=new Set<string>();
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const samePath=(a:string,b:string)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
const options={provider:'local',backend:'pipeline',cloudMode:'extract',method:'auto',language:'ch',formula:true,table:true,imageAnalysis:false,effort:'medium',formats:['md','json'],timeout:1800,force:false,extraArgs:[],env:{}};
function get(service:ProjectService,id:string){const job=service.db.prepare('SELECT * FROM conversions WHERE id=?').get(id) as Conversion|undefined;if(!job)throw new Error('CONVERSION_NOT_FOUND');return job}
function change(service:ProjectService,job:Conversion,patch:Partial<Conversion>){
  const next={...job,...patch};service.db.transaction(()=>{
    service.db.prepare('UPDATE conversions SET status=@status,taskId=@taskId,sampleTaskId=@sampleTaskId,paperHash=@paperHash,mapHash=@mapHash WHERE id=@id').run(next);
    service.emit('conversion.status.changed',{id:next.id,sourceId:next.sourceId,status:next.status});
  })();return next;
}
function sourceInfo(service:ProjectService,sourceId:string){
  const source=service.snapshot().sources.find(s=>s.id===sourceId);if(!source)throw new Error('SOURCE_NOT_FOUND');
  if(!source.name.toLowerCase().endsWith('.pdf'))throw new Error('PDF_REQUIRED');
  const path=projectPath(service.root,source.relpath);if(digest(readFileSync(path))!==source.sha256)throw new Error('SOURCE_CHANGED');
  return {source,path};
}
function jobPath(service:ProjectService,job:Conversion,relative:string){return projectPath(service.root,`.cyz/conversions/${job.id}/${relative}`,true)}
async function submit(service:ProjectService,job:Conversion,client:ConversionClient,pages:string|null){
  const {path}=sourceInfo(service,job.sourceId);
  if(!(await client.preflight()).offline)throw new Error('MINERU_OFFLINE_REQUIRED');
  const stage=pages===null?'full':'sample';
  const output=jobPath(service,job,stage+'-output');mkdirSync(output,{recursive:true});
  const requestFile=jobPath(service,job,stage+'-request.json');
  writeFileSync(requestFile,JSON.stringify({files:[path],outputRoot:output,options:{...options,...(pages===null?{}:{pages})}}),{flag:'wx'});
  job=change(service,job,{status:stage+'_submitting'});
  let taskId:string;
  try{taskId=await client.submit(requestFile);if(!/^[A-Za-z0-9-]+$/.test(taskId))throw new Error('INVALID_TASK_ID')}
  catch{change(service,job,{status:'reconciling'});throw new Error('CONVERSION_SUBMISSION_UNKNOWN')}
  return change(service,job,{status:stage+'_running',taskId,sampleTaskId:pages===null?job.sampleTaskId:taskId});
}
export async function startConversion(service:ProjectService,sourceId:string,client:ConversionClient):Promise<Conversion>{
  sourceInfo(service,sourceId);
  const existing=listConversions(service).filter(j=>j.sourceId===sourceId&&j.status!=='failed').at(-1);
  if(existing){if(existing.status==='completed')readConversion(service,existing.id);return existing}
  const job:Conversion={id:randomUUID(),sourceId,status:'preparing',taskId:null,sampleTaskId:null,paperHash:null,mapHash:null};
  service.db.prepare('INSERT INTO conversions(id,sourceId,status,createdAt) VALUES(?,?,?,?)').run(job.id,sourceId,job.status,new Date().toISOString());
  try{
    if(!(await client.preflight()).offline)throw new Error('MINERU_OFFLINE_REQUIRED');
    const count=await client.pages(sourceInfo(service,sourceId).path);if(!Number.isSafeInteger(count)||count<1)throw new Error('INVALID_PDF_PAGE_COUNT');
    return await submit(service,job,client,'1-'+Math.min(count,3));
  }catch(error){if(get(service,job.id).status==='preparing')change(service,job,{status:'failed'});throw error}
}
async function locked<T>(id:string,work:()=>Promise<T>){if(busy.has(id))throw new Error('CONVERSION_BUSY');busy.add(id);try{return await work()}finally{busy.delete(id)}}
export async function pollConversion(service:ProjectService,id:string,client:ConversionClient):Promise<Conversion>{return locked(id,async()=>{
  let job=get(service,id);if(!['sample_running','full_running','finalizing'].includes(job.status)||!job.taskId)return job;
  const {source,path}=sourceInfo(service,job.sourceId);const task=await client.task(job.taskId);
  if(task.id!==job.taskId||!samePath(task.source,path)){change(service,job,{status:'reconciling'});throw new Error('CONVERSION_IDENTITY_MISMATCH')}
  if(['queued','running'].includes(task.status))return job;
  if(['failed','cancelled'].includes(task.status))return change(service,job,{status:'failed'});
  if(!['completed','reused'].includes(task.status)){change(service,job,{status:'reconciling'});throw new Error('CONVERSION_STATUS_UNKNOWN')}
  if(job.status==='sample_running'){
    const content=await client.content(job.taskId);if(typeof content!=='string'||content.trim().length<20||content.length>10_000_000)throw new Error('SAMPLE_CONTENT_INVALID');
    writeFileSync(jobPath(service,job,'sample.md'),content);return change(service,job,{status:'sample_review'});
  }
  job=change(service,job,{status:'finalizing'});
  await client.finalize(job.taskId!,path,jobPath(service,job,'cache'));
  const paper=readFileSync(jobPath(service,job,'cache/paper.md')),map=readFileSync(jobPath(service,job,'cache/source_map.json'));
  const metadata=JSON.parse(map.toString('utf8'));if(metadata.pdf_sha256!==source.sha256||!Array.isArray(metadata.pages)||!metadata.pages.length)throw new Error('CACHE_SOURCE_MISMATCH');
  sourceInfo(service,job.sourceId);
  return change(service,job,{status:'completed',paperHash:digest(paper),mapHash:digest(map)});
})}
export async function approveSample(service:ProjectService,id:string,client:ConversionClient):Promise<Conversion>{return locked(id,async()=>{
  const job=get(service,id);if(['full_running','finalizing','completed'].includes(job.status))return job;
  if(job.status!=='sample_review')throw new Error('SAMPLE_REVIEW_REQUIRED');
  service.emit('conversion.sample.approved',{id,sourceId:job.sourceId});return submit(service,job,client,null);
})}
export function listConversions(service:ProjectService):Conversion[]{return service.db.prepare('SELECT * FROM conversions ORDER BY rowid').all() as Conversion[]}
export function readConversion(service:ProjectService,id:string){
  const job=get(service,id);sourceInfo(service,job.sourceId);
  if(job.status==='sample_review')return {scope:'sample',text:readFileSync(jobPath(service,job,'sample.md'),'utf8'),pages:[]};
  if(job.status!=='completed')throw new Error('CONVERSION_NOT_READY');
  const paperPath=jobPath(service,job,'cache/paper.md');if(statSync(paperPath).size>20_000_000)throw new Error('CACHE_TOO_LARGE');
  const paper=readFileSync(paperPath),map=readFileSync(jobPath(service,job,'cache/source_map.json'));
  if(digest(paper)!==job.paperHash||digest(map)!==job.mapHash)throw new Error('CACHE_INTEGRITY_ERROR');
  return {scope:'full',text:paper.toString('utf8'),pages:JSON.parse(map.toString('utf8')).pages};
}
