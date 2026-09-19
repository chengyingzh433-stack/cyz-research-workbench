import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexEngine} from '../packages/codex-adapter/src/engine.ts';
const cwd=await mkdtemp(join(tmpdir(),'cyz native turn '));
const kinds=new Set<string>();
let output='',status='',sandbox='';
let settle:()=>void=()=>{};
const finished=new Promise<void>(resolve=>settle=resolve);
const engine=new CodexEngine(event=>{
  kinds.add(event.type);
  if(event.type==='session.started')sandbox=String(event.payload.sandbox);
  if(event.type==='message.completed')output+=event.payload.text;
  if(event.type==='task.status.changed'&&['completed','failed','interrupted'].includes(String(event.payload.status))){status=String(event.payload.status);settle()}
  if(event.type==='recovery.required'){status=String(event.payload.reason);settle()}
  if(event.type==='decision.requested'){status='UNEXPECTED_DECISION';settle()}
});
let timer:ReturnType<typeof setTimeout>|undefined;
try{
  await engine.start(cwd,'这是工作台连接测试，不是开发任务。请只回复 CYZ_CONNECTION_OK。不要调用工具、读取文件、启动子智能体或目标模式。');
  await Promise.race([finished,new Promise<void>((_,reject)=>{timer=setTimeout(()=>reject(new Error('PROBE_TIMEOUT')),60000)})]);
  const report={recordedAt:new Date().toISOString(),modelTurnsStarted:1,status,sandbox,expectedReply:output.trim()==='CYZ_CONNECTION_OK',eventTypes:[...kinds],rawConversationRetained:false,notYetVerified:['interrupt','resume','approval','sandbox write enforcement']};
  await mkdir('docs/acceptance',{recursive:true});
  await writeFile('docs/acceptance/codex-turn-probe.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(status!=='completed'||!report.expectedReply)process.exitCode=1;
}finally{if(timer)clearTimeout(timer);await engine.stop().catch(()=>{});engine.close()}
