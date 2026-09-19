import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectService} from '../packages/project-service/src/project.ts';
import {prepareTask} from '../packages/project-service/src/tasks.ts';
import {reconcileTask} from '../packages/project-service/src/recovery.ts';
import {CodexEngine} from '../packages/codex-adapter/src/engine.ts';
const project=await ProjectService.create(await mkdtemp(join(tmpdir(),'cyz 恢复实测 ')));
const task=await prepareTask(project,'S0','只读恢复测试');
let finish:()=>void=()=>{};const completed=new Promise<void>(resolve=>finish=resolve);
let terminal='';let timer:ReturnType<typeof setTimeout>|undefined;
const engine=new CodexEngine(event=>{
  if(event.type==='session.started')project.db.prepare('UPDATE tasks SET threadId=? WHERE id=?').run(event.payload.threadId,task.taskId);
  if(event.type==='task.status.changed'&&event.payload.turnId)project.db.prepare('UPDATE tasks SET turnId=? WHERE id=?').run(event.payload.turnId,task.taskId);
  if(event.type==='task.status.changed'&&['completed','interrupted','failed'].includes(String(event.payload.status))){terminal=String(event.payload.status);finish()}
  if(event.type==='recovery.required'||event.type==='decision.requested'){terminal='unexpected';finish()}
});
const inspector=new CodexEngine(()=>{});
try{
  await engine.start(task.cwd,'本轮仅用于连接恢复测试。不要调用工具、子智能体或目标模式，只回复 RECOVERY_OK。');
  await Promise.race([completed,new Promise<void>((_,reject)=>{timer=setTimeout(()=>reject(new Error('PROBE_TIMEOUT')),60000)})]);
  if(terminal!=='completed')throw new Error('INITIAL_TURN_NOT_COMPLETED');
  engine.close();project.db.prepare("UPDATE tasks SET status='reconciling' WHERE id=?").run(task.taskId);
  let reads=0;
  const result=await reconcileTask(project,task.taskId,async thread=>{reads++;return inspector.inspect(thread)});
  const replies=project.eventsAfter(0).filter(e=>e.type==='message.completed');
  const report={recordedAt:new Date().toISOString(),modelTurnsStarted:1,recoveryModelTurnsStarted:0,runtimeReads:reads,status:result.status,reason:result.reason??null,recoveredExpectedReply:replies.some(e=>e.payload.text.trim()==='RECOVERY_OK'),taskCount:project.snapshot().tasks.length};
  await writeFile('docs/acceptance/codex-recovery-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  if(result.status!=='completed'||!report.recoveredExpectedReply||report.taskCount!==1)process.exitCode=1;
}finally{if(timer)clearTimeout(timer);await engine.stop().catch(()=>{});engine.close();inspector.close();project.close()}
