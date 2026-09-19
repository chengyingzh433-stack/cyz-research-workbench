import {resolve,relative,isAbsolute,sep} from 'node:path';
import type {SandboxPolicy} from '../generated/v2/SandboxPolicy.ts';
export function runSandbox(cwd:string):SandboxPolicy{
  return {type:'workspaceWrite',writableRoots:[resolve(cwd)],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true};
}
export function assertIsolation(cwd:string,result:{cwd?:unknown;sandbox?:unknown}){
  const policy=result.sandbox as Partial<Extract<SandboxPolicy,{type:'workspaceWrite'}>>|undefined;
  const same=(a:string,b:string)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
  const inside=(path:string)=>{const rel=relative(resolve(cwd),resolve(path));return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep)};
  if(typeof result.cwd!=='string'||!same(result.cwd,cwd)||policy?.type!=='workspaceWrite'||!Array.isArray(policy.writableRoots)||policy.writableRoots.some(path=>typeof path!=='string'||!inside(path))||!policy.excludeTmpdirEnvVar||!policy.excludeSlashTmp)throw new Error('CODEX_ISOLATION_NOT_CONFIRMED');
}
