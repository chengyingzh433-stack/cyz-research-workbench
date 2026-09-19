import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,readFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import type {ConversionClient} from '../../project-service/src/conversions.ts';
const execute=promisify(execFile);
export function isOwnedTaskFailure(stdout:string,code:unknown,taskId:string|undefined):boolean{
  if(code!==2||!taskId)return false;try{const payload=JSON.parse(stdout);return payload.id===taskId&&payload.status==='failed'}catch{return false}
}

async function run(file:string,args:string[],timeout=150000,failedTaskId?:string){
  try{return await execute(file,args,{windowsHide:true,shell:false,encoding:'utf8',timeout,maxBuffer:20*1024*1024,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}})}
  catch(error){if(error&&typeof error==='object'&&'stdout' in error&&'code' in error&&typeof error.stdout==='string'&&isOwnedTaskFailure(error.stdout,error.code,failedTaskId))return {stdout:error.stdout};throw new Error('MINERU_COMMAND_FAILED')}
}
export function powershellInvocation(cli:string,args:string[]){
  const values=[cli,...args];if(values.some(value=>/[\r\n\0]/.test(value)))throw new Error('INVALID_MINERU_ARGUMENT');
  const quoted=values.map(value=>"'"+value.replaceAll("'","''")+"'");
  const script='[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); & '+quoted.join(' ')+'; exit $LASTEXITCODE';
  return ['-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
}
export async function findDesk(){
  if(process.env.CYZ_MINERU_ROOT)return resolve(process.env.CYZ_MINERU_ROOT);
  const result=await run('powershell.exe',['-NoProfile','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); (Get-ItemProperty 'HKCU:\\Software\\MinerUDesk' -Name InstallDir -ErrorAction Stop).InstallDir"],30000);
  if(!result.stdout.trim())throw new Error('MINERU_NOT_FOUND');return resolve(result.stdout.trim());
}
export class DeskClient implements ConversionClient{
  readonly root:string;readonly skill:string;readonly python:string;
  private checked?:Promise<void>;
  constructor(root:string,skill=join(process.env.USERPROFILE??'','.codex','skills','cyz-edu-research')){
    this.root=resolve(root);this.skill=resolve(skill);this.python=join(this.root,'runtime','python.exe');
    for(const path of [join(this.root,'Codex.ps1'),this.python,join(this.skill,'scripts','export_mineru_task.py'),join(this.skill,'scripts','convert_pdf_to_md.py')])if(!existsSync(path))throw new Error('MINERU_DEPENDENCY_MISSING');
    const bundle=JSON.parse(readFileSync(join(this.root,'mineru-desk-bundle.json'),'utf8'));
    if(bundle.name!=='MinerU Desk'||bundle.version!=='0.3.1'||bundle.platform!=='win32-x64')throw new Error('MINERU_VERSION_UNVERIFIED');
  }
  async command(...args:string[]){const taskId=args[0]==='request'&&args[1]==='GET'&&/^tasks\/[A-Za-z0-9-]+$/.test(args[2]??'')?args[2].slice(6):undefined;const result=await run('powershell.exe',powershellInvocation(join(this.root,'Codex.ps1'),args),args[0]==='verify'?1200000:150000,taskId);try{return JSON.parse(result.stdout)}catch{throw new Error('MINERU_INVALID_RESPONSE')}}
  async preflight(){
    this.checked??=(async()=>{
      const verification=await this.command('verify');if(verification.status!=='passed'||verification.checked<1)throw new Error('MINERU_INSTALLATION_INVALID');
      const doctor=await this.command('doctor');if(doctor.checks?.runtime!=='passed')throw new Error('MINERU_RUNTIME_UNAVAILABLE');
      if(doctor.checks?.models==='missing')throw new Error('MINERU_MODELS_MISSING');
    })();
    try{await this.checked}catch(error){this.checked=undefined;throw error}
    const state=await this.command('request','GET','state');
    if(state.paused)throw new Error('MINERU_QUEUE_PAUSED');
    return {offline:state.settings?.offline===true&&!state.settings.serverUrl&&!state.settings.vlmUrl};
  }
  async pages(source:string){const result=await run(this.python,['-c',"import sys,json; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from convert_pdf_to_md import get_pdf_info; print(json.dumps(get_pdf_info(Path(sys.argv[2]))[0]))",join(this.skill,'scripts'),source],30000);return JSON.parse(result.stdout) as number}
  async submit(requestFile:string){const result=await this.command('submit',requestFile);if(!Array.isArray(result)||result.length!==1||typeof result[0].id!=='string')throw new Error('MINERU_INVALID_SUBMISSION');return result[0].id as string}
  async task(id:string){if(!/^[A-Za-z0-9-]+$/.test(id))throw new Error('INVALID_MINERU_TASK');const task=await this.command('request','GET','tasks/'+id);return {id:task.id,status:task.status,source:task.source}}
  async content(id:string){if(!/^[A-Za-z0-9-]+$/.test(id))throw new Error('INVALID_MINERU_TASK');const result=await this.command('request','GET','tasks/'+id+'/content');return result.original as string}
  async finalize(id:string,source:string,output:string){
    if(!/^[A-Za-z0-9-]+$/.test(id))throw new Error('INVALID_MINERU_TASK');
    const record=join(dirname(output),'exported-task.json');
    await run(this.python,[join(this.skill,'scripts','export_mineru_task.py'),'--desk-root',this.root,'--task-id',id,'--output',record]);
    await run(this.python,[join(this.skill,'scripts','convert_pdf_to_md.py'),source,'--output-dir',output,'--mineru-task',record,'--image-mode','auto'],300000);
  }
}
