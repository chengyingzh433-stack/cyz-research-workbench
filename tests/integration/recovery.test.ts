import {afterEach,expect,it} from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectService} from '../../packages/project-service/src/project.ts';
import {prepareTask} from '../../packages/project-service/src/tasks.ts';
import {reconcileTask} from '../../packages/project-service/src/recovery.ts';
const services:ProjectService[]=[];
afterEach(()=>{for(const service of services.splice(0))service.close()});
async function setup(){
  const service=await ProjectService.create(await mkdtemp(join(tmpdir(),'cyz 恢复 ')));services.push(service);
  const task=await prepareTask(service,'S0','测试核实');
  service.db.prepare("UPDATE tasks SET status='reconciling',threadId='owned-thread',turnId='owned-turn' WHERE id=?").run(task.taskId);
  const inspection={threadId:'owned-thread',cwd:task.cwd,turns:[{id:'owned-turn',status:'completed',messages:[{id:'answer-1',text:'确认完成的回复'}]}]};
  return {service,task,inspection};
}
it('restores the exact terminal turn and public messages once without starting a new attempt',async()=>{
  const {service,task,inspection}=await setup();let reads=0;
  const reader=async(id:string)=>{reads++;expect(id).toBe('owned-thread');return inspection};
  expect(await reconcileTask(service,task.taskId,reader)).toMatchObject({status:'completed'});
  const seq=service.snapshot().snapshotSeq;
  expect(await reconcileTask(service,task.taskId,reader)).toMatchObject({status:'completed'});
  expect(service.snapshot().snapshotSeq).toBe(seq);expect(reads).toBe(1);
  expect(service.snapshot().tasks).toMatchObject([{id:task.taskId,runId:task.runId,status:'completed'}]);
  expect(service.eventsAfter(0).filter(e=>e.type==='message.completed')).toHaveLength(1);
});
it.each(['cwd','thread','turn','running','failure'])('keeps uncertain %s results blocked',async(kind)=>{
  const {service,task,inspection}=await setup();
  if(kind==='cwd')inspection.cwd=service.root;
  if(kind==='thread')inspection.threadId='another-thread';
  if(kind==='turn')inspection.turns[0].id='another-turn';
  if(kind==='running')inspection.turns[0].status='inProgress';
  const result=await reconcileTask(service,task.taskId,async()=>{if(kind==='failure')throw new Error('private runtime output');return inspection});
  expect(result.status).toBe('reconciling');expect(JSON.stringify(result)).not.toContain('private runtime output');
  expect(service.snapshot().tasks).toMatchObject([{status:'reconciling'}]);
  expect(service.eventsAfter(0).filter(e=>e.type==='message.completed')).toHaveLength(0);
});
it('does not contact the runtime when no owned session was recorded',async()=>{
  const {service,task}=await setup();service.db.prepare('UPDATE tasks SET threadId=NULL WHERE id=?').run(task.taskId);
  let called=false;const result=await reconcileTask(service,task.taskId,async()=>{called=true;throw new Error('must not run')});
  expect(called).toBe(false);expect(result).toMatchObject({status:'reconciling',reason:'SESSION_NOT_RECORDED'});
});
