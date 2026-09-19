import {existsSync,readFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import type {UserInput} from '../../codex-adapter/generated/v2/UserInput.ts';
export function codexHome(){return resolve(process.env.CODEX_HOME||join(process.env.USERPROFILE??'','.codex'))}
export function workflowSkillPath(home=codexHome()){
  const path=join(home,'skills','cyz-edu-research','SKILL.md');
  if(!existsSync(path)||!existsSync(join(dirname(path),'VERSION')))throw new Error('WORKFLOW_NOT_INSTALLED');
  if(readFileSync(join(dirname(path),'VERSION'),'utf8').trim()!=='0.3.0')throw new Error('WORKFLOW_VERSION_UNVERIFIED');
  return path;
}
type Catalog={data:{cwd:string;skills:{name:string;path:string;enabled:boolean}[]}[]};
const canonical=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
export function workflowTurnInput(prompt:string,path:string,cwd:string,catalog:Catalog):UserInput[]{
  const found=catalog.data?.some(entry=>canonical(entry.cwd)===canonical(cwd)&&entry.skills.some(skill=>skill.enabled&&skill.name==='cyz-edu-research'&&canonical(skill.path)===canonical(path)));
  if(!found)throw new Error('WORKFLOW_NOT_DISCOVERED');
  return [{type:'text',text:'$cyz-edu-research\n'+prompt,text_elements:[]},{type:'skill',name:'cyz-edu-research',path}];
}
