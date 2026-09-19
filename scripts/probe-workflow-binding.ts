import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {findCodex} from '../packages/codex-adapter/src/engine.ts';
import {RpcTransport} from '../packages/codex-adapter/src/transport.ts';
import {workflowSkillPath,workflowTurnInput} from '../packages/workflow-adapter/src/skill-binding.ts';
import type {SkillsListResponse} from '../packages/codex-adapter/generated/v2/SkillsListResponse.ts';
const child=spawn(findCodex(),['app-server','--stdio'],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
child.stderr.on('data',()=>{});
const rpc=new RpcTransport(child.stdout,child.stdin);child.once('error',()=>rpc.close('SPAWN_FAILED'));child.once('exit',()=>rpc.close());
try{
  await rpc.request('initialize',{clientInfo:{name:'cyz_workflow_binding_probe',version:'0.1.0'},capabilities:{experimentalApi:false}});rpc.notify('initialized');
  const cwd=resolve('.');const catalog=await rpc.request('skills/list',{cwds:[cwd],forceReload:true}) as SkillsListResponse;
  const input=workflowTurnInput('只读接入检查',workflowSkillPath(),cwd,catalog);
  const report={recordedAt:new Date().toISOString(),workflow:'cyz-edu-research',version:'0.3.0',discovered:true,enabled:true,explicitInputType:input[1].type,modelTurnsStarted:0};
  await writeFile('docs/acceptance/workflow-binding-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{rpc.close();child.stdin.end();const timer=setTimeout(()=>{if(child.exitCode===null)child.kill()},3000);timer.unref();child.once('exit',()=>clearTimeout(timer))}
