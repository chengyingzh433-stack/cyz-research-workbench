import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {ProjectService} from '../../packages/project-service/src/project.ts';
const services:ProjectService[]=[];
const children:ChildProcess[]=[];
afterEach(()=>{for(const child of children.splice(0))if(child.exitCode===null)child.kill();for(const service of services.splice(0))service.close()});
const moduleUrl=pathToFileURL(resolve('packages/project-service/src/project.ts')).href;
const openCode=`import {ProjectService} from ${JSON.stringify(moduleUrl)}; try {const project=await ProjectService.open(process.argv[1]); console.log('OPENED'); project.close()} catch(e){console.log(e.message)}`;
it('blocks a second process while allowing it after the first closes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyz 跨进程锁 '));const service=await ProjectService.create(root);services.push(service);
  expect(execFileSync(process.execPath,['--input-type=module','-e',openCode,root],{encoding:'utf8',windowsHide:true}).trim()).toBe('PROJECT_ALREADY_OPEN');
  service.close();
  expect(execFileSync(process.execPath,['--input-type=module','-e',openCode,root],{encoding:'utf8',windowsHide:true}).trim()).toBe('OPENED');
});
it('releases the operating-system lock after the owner crashes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyz 崩溃锁 '));const initial=await ProjectService.create(root);initial.close();
  const code=`import {ProjectService} from ${JSON.stringify(moduleUrl)}; await ProjectService.open(process.argv[1]); console.log('READY'); setInterval(()=>{},1000)`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,root],{windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);
  const [chunk]=await once(child.stdout!,'data');expect(String(chunk).trim()).toBe('READY');
  await expect(ProjectService.open(root)).rejects.toThrow('PROJECT_ALREADY_OPEN');
  const exited=once(child,'exit');child.kill();await exited;
  const reopened=await ProjectService.open(root);services.push(reopened);expect(reopened.snapshot().project.root).toBe(root);
});
it('blocks a different path carrying the same project identity in another process',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyz 原项目 '));const service=await ProjectService.create(root);services.push(service);
  const copied=await mkdtemp(join(tmpdir(),'cyz 副本 '));await mkdir(join(copied,'.cyz'));
  await copyFile(join(root,'.cyz/project.json'),join(copied,'.cyz/project.json'));
  expect(execFileSync(process.execPath,['--input-type=module','-e',openCode,copied],{encoding:'utf8',windowsHide:true}).trim()).toBe('PROJECT_ALREADY_OPEN');
});
