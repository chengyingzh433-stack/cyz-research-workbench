import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectService} from '../../packages/project-service/src/project.ts';
import {prepareTask} from '../../packages/project-service/src/tasks.ts';
import {listCandidates,publishCandidate} from '../../packages/project-service/src/candidates.ts';
const services:ProjectService[]=[];
afterEach(()=>{for(const service of services.splice(0))service.close()});
async function create(){const service=await ProjectService.create(await mkdtemp(join(tmpdir(),'cyz 候选 ')));services.push(service);return service}
function complete(service:ProjectService,id:string){service.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(id)}
it('lists only changed Markdown and publishes only after explicit selection',async()=>{
  const service=await create();await writeFile(join(service.root,'状态.md'),'原状态');
  const task=await prepareTask(service,'S0','测试');await writeFile(join(task.cwd,'研究建议.md'),'待审核建议');complete(service,task.taskId);
  const items=await listCandidates(service,task.taskId);expect(items.map(i=>i.relpath)).toEqual(['研究建议.md']);
  expect(service.snapshot().artifacts).toEqual([]);
  const result=await publishCandidate(service,task.taskId,items[0].relpath,items[0].sha256);
  expect(result.status).toBe('published');expect(await readFile(join(service.root,'研究建议.md'),'utf8')).toBe('待审核建议');
});
it('rejects incomplete tasks and changed previews',async()=>{
  const service=await create();const task=await prepareTask(service,'S0','测试');
  await expect(listCandidates(service,task.taskId)).rejects.toThrow('TASK_NOT_COMPLETED');
  await writeFile(join(task.cwd,'候选.md'),'before');complete(service,task.taskId);
  const [item]=await listCandidates(service,task.taskId);await writeFile(join(task.cwd,'候选.md'),'after');
  await expect(publishCandidate(service,task.taskId,item.relpath,item.sha256)).rejects.toThrow('CANDIDATE_CHANGED');
});
it('uses a trusted base manifest even if the model overwrites its context copy',async()=>{
  const service=await create();const first=await service.saveArtifact('draft.md','baseline',null);
  const task=await prepareTask(service,'S7','测试');
  const human=await service.saveArtifact('draft.md','human',first.versionId);
  await writeFile(join(task.cwd,'draft.md'),'model candidate');
  await writeFile(join(task.cwd,'CYZ_RUN_CONTEXT.json'),JSON.stringify({artifacts:[{relpath:'draft.md',baseVersionId:human.versionId}]}));
  complete(service,task.taskId);const [item]=await listCandidates(service,task.taskId);
  const result=await publishCandidate(service,task.taskId,item.relpath,item.sha256);
  expect(result.status).toBe('conflict');expect(await readFile(join(service.root,'draft.md'),'utf8')).toBe('human');
  expect(service.readVersion(result.versionId)).toBe('model candidate');
});
it('rejects paths outside a run',async()=>{
  const service=await create();const task=await prepareTask(service,'S0','测试');complete(service,task.taskId);
  await expect(publishCandidate(service,task.taskId,'../outside.md','x')).rejects.toThrow('INVALID_PATH');
});
