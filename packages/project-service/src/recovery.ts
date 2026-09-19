import type {ProjectService} from './project.ts';
import {resolve} from 'node:path';
import {projectPath} from './path-policy.ts';
export type RuntimeInspection={threadId:string;cwd:string;turns:{id:string;status:string;messages:{id:string;text:string}[]}[]};
export type RuntimeReader=(threadId:string)=>Promise<RuntimeInspection>;
export async function reconcileTask(service:ProjectService,taskId:string,read:RuntimeReader):Promise<{status:string;reason?:string}>{
  const task=service.db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId) as {id:string;runId:string;threadId:string|null;turnId:string|null;status:string}|undefined;
  if(!task)throw new Error('TASK_NOT_FOUND');
  const terminal=['completed','interrupted','failed'];
  if(terminal.includes(task.status))return {status:task.status};
  if(task.status!=='reconciling')throw new Error('TASK_NOT_RECONCILING');
  const unknown=(reason:string)=>({status:'reconciling',reason});
  if(!task.threadId)return unknown('SESSION_NOT_RECORDED');
  if(!task.turnId)return unknown('TURN_NOT_RECORDED');
  let runtime:RuntimeInspection;
  try{runtime=await read(task.threadId)}catch{return unknown('RUNTIME_READ_FAILED')}
  const cwd=projectPath(service.root,`.cyz/runs/${task.runId}/workspace`,true);
  const canonical=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
  if(runtime.threadId!==task.threadId||canonical(runtime.cwd)!==canonical(cwd))return unknown('RUNTIME_IDENTITY_MISMATCH');
  const turn=runtime.turns.find(t=>t.id===task.turnId);
  if(!turn)return unknown('TURN_NOT_FOUND');
  if(!terminal.includes(turn.status))return unknown('TURN_NOT_TERMINAL');
  return service.db.transaction(()=>{
    const latest=service.db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId) as {status:string};
    if(latest.status!=='reconciling')return {status:latest.status};
    const seen=new Set(service.eventsAfter(0).filter(e=>e.type==='message.completed'&&e.payload.taskId===taskId).map(e=>e.payload.id));
    for(const message of turn.messages){if(!seen.has(message.id)){service.emit('message.completed',{...message,taskId,recovered:true});seen.add(message.id)}}
    service.db.prepare('UPDATE tasks SET status=? WHERE id=?').run(turn.status,taskId);
    service.emit('task.status.changed',{taskId,turnId:task.turnId,status:turn.status,recovered:true});
    service.emit('task.reconciled',{taskId,source:'codex thread/read',status:turn.status});
    return {status:turn.status};
  })();
}
