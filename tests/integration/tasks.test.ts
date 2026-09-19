import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectService} from '../../packages/project-service/src/project.ts';
import {prepareTask} from '../../packages/project-service/src/tasks.ts';
const services:ProjectService[]=[];
afterEach(()=>{for(const service of services.splice(0))service.close()});
async function create(){const service=await ProjectService.create(await mkdtemp(join(tmpdir(),'cyz 任务 ')));services.push(service);return service}
it('copies context into an isolated workspace without changing formal files',async()=>{
  const service=await create();await writeFile(join(service.root,'状态.md'),'人工状态');
  const task=await prepareTask(service,'S0','测试任务');
  expect(await readFile(join(task.cwd,'状态.md'),'utf8')).toBe('人工状态');
  await writeFile(join(task.cwd,'状态.md'),'候选状态');
  expect(await readFile(join(service.root,'状态.md'),'utf8')).toBe('人工状态');
  expect(service.snapshot().tasks).toMatchObject([{id:task.taskId,status:'queued'}]);
});
it('does not start a second task while another status is uncertain',async()=>{
  const service=await create();const task=await prepareTask(service,'S1','第一项');
  service.db.prepare("UPDATE tasks SET status='reconciling' WHERE id=?").run(task.taskId);
  await expect(prepareTask(service,'S1','第二项')).rejects.toThrow('TASK_NEEDS_ATTENTION');
  expect(service.snapshot().tasks).toHaveLength(1);
});
it('rejects concurrent starts before asynchronous context copying',async()=>{
  const service=await create();
  const results=await Promise.allSettled([prepareTask(service,'S0','甲'),prepareTask(service,'S0','乙')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(service.snapshot().tasks).toHaveLength(1);
});
it('records a failed preparation without blocking a later corrected task',async()=>{
  const service=await create();await writeFile(join(service.root,'过大.md'),'x'.repeat(2*1024*1024+1));
  await expect(prepareTask(service,'S0','测试')).rejects.toThrow('CONTEXT_FILE_TOO_LARGE');
  expect(service.snapshot().tasks).toMatchObject([{status:'failed'}]);
  await writeFile(join(service.root,'过大.md'),'缩小后的内容');
  await expect(prepareTask(service,'S0','重试')).resolves.toHaveProperty('cwd');
});
it('validates the stage and objective before registering a task',async()=>{
  const service=await create();await expect(prepareTask(service,'S9','测试')).rejects.toThrow('INVALID_STAGE');
  await expect(prepareTask(service,'S0',' ')).rejects.toThrow('INVALID_OBJECTIVE');
  expect(service.snapshot().tasks).toEqual([]);
});
it('includes saved nested drafts with a fixed base-version manifest',async()=>{
  const service=await create();const saved=await service.saveArtifact('07-论文草稿/工作台草稿.md','已保存草稿',null);
  const task=await prepareTask(service,'S7','继续写作');
  expect(await readFile(join(task.cwd,'07-论文草稿/工作台草稿.md'),'utf8')).toBe('已保存草稿');
  const context=JSON.parse(await readFile(join(task.cwd,'CYZ_RUN_CONTEXT.json'),'utf8'));
  expect(context.artifacts).toMatchObject([{relpath:'07-论文草稿/工作台草稿.md',baseVersionId:saved.versionId}]);
});
