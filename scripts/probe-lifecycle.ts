import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexEngine} from '../packages/codex-adapter/src/engine.ts';
import type {ResearchEvent} from '../packages/codex-adapter/src/normalize.ts';
const cwd=await mkdtemp(join(tmpdir(),'cyz lifecycle '));
let threadId:string|undefined;
const results:{name:string;status:string;replyMatched:boolean}[]=[];
async function run(name:string,prompt:string,expected:string,interrupt=false){
  let finish:()=>void=()=>{},status='',reply='';
  const done=new Promise<void>(resolve=>finish=resolve);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const engine=new CodexEngine((event:ResearchEvent)=>{
    if(event.type==='session.started')threadId=String(event.payload.threadId);
    if(event.type==='message.completed')reply+=event.payload.text;
    if(event.type==='task.status.changed'){
      if(interrupt&&event.payload.status==='running')void engine.stop().catch(()=>{status='STOP_FAILED';finish()});
      if(['completed','failed','interrupted'].includes(String(event.payload.status))){status=String(event.payload.status);finish()}
    }
    if(event.type==='recovery.required'||event.type==='decision.requested'){status='NEEDS_ATTENTION';finish()}
  });
  try{
    await engine.start(cwd,prompt,threadId);
    await Promise.race([done,new Promise<void>((_,reject)=>{timer=setTimeout(()=>reject(new Error('PROBE_TIMEOUT')),60000)})]);
    results.push({name,status,replyMatched:interrupt?status==='interrupted':reply.trim()===expected});
  }finally{if(timer)clearTimeout(timer);await engine.stop().catch(()=>{});engine.close()}
}
try{
  await run('initial','仅作连接测试。请记住代号 CYZ_73921，只回复 READY。不要使用工具、子智能体或目标模式。','READY');
  await run('resume','不要使用工具，只回复我在上一轮要求记住的代号。','CYZ_73921');
  await run('interrupt','本轮只测试中断，不要使用工具；请逐行输出 1 到 1000 的整数。','',true);
}finally{
  const report={recordedAt:new Date().toISOString(),modelTurnsStarted:results.length,results,notYetVerified:['interactive approval','user input','sandbox write enforcement'],rawConversationRetained:false};
  await writeFile('docs/acceptance/codex-lifecycle-probe.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(results.length!==3||results.some(r=>!r.replyMatched))process.exitCode=1;
}
