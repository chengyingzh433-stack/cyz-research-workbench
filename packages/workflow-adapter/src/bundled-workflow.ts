import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {codexHome} from './skill-binding.ts';

function inventory(root:string,prefix=''):string[]{
  if(lstatSync(root).isSymbolicLink())throw new Error('BUNDLE_INVALID: symbolic link');
  return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{
    const name=prefix+entry.name;
    if(entry.isSymbolicLink())throw new Error('BUNDLE_INVALID: symbolic link');
    if(entry.isDirectory())return inventory(join(root,entry.name),name+'/');
    if(!entry.isFile())throw new Error('BUNDLE_INVALID: special file');
    return [name];
  });
}
function noLinks(path:string){
  for(let current=resolve(path);;current=dirname(current)){
    if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('WORKFLOW_LOCAL_CONFLICT: symbolic link');
    if(dirname(current)===current)break;
  }
}
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');

/** Copy a verified offline release. Never replace an existing skill, even partially. */
export function installBundledWorkflow(bundle:string,home=codexHome()){
  const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8'));
  if(manifest.version!=='0.3.0'||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw new Error('BUNDLE_INVALID');
  const entries=Object.entries(manifest.files);
  if(!manifest.files['SKILL.md']||!manifest.files['VERSION']||entries.length>2000)throw new Error('BUNDLE_INVALID');
  for(const [name,digest] of entries){
    if(name.includes('\\')||name.includes(':')||name.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part))||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw new Error('BUNDLE_INVALID');
  }
  const source=join(bundle,'cyz-edu-research');
  if(JSON.stringify(inventory(source).sort())!==JSON.stringify(entries.map(([name])=>name).sort()))throw new Error('BUNDLE_INVALID: inventory mismatch');
  const verified=new Map<string,Buffer>();
  for(const [name,digest] of entries){
    const data=readFileSync(join(source,name));
    if(hash(data)!==digest)throw new Error('BUNDLE_HASH_MISMATCH: '+name);
    verified.set(name,data);
  }
  if(verified.get('VERSION')!.toString('utf8').trim()!=='0.3.0')throw new Error('BUNDLE_INVALID: version');
  const parent=join(resolve(home),'skills');const destination=join(parent,'cyz-edu-research');
  noLinks(destination);
  if(existsSync(destination)){
    for(const [name,data] of verified){
      const path=join(destination,name);noLinks(path);
      if(!existsSync(path)||!lstatSync(path).isFile()||!readFileSync(path).equals(data))throw new Error('WORKFLOW_LOCAL_CONFLICT: '+name);
    }
    return {status:'already_verified' as const,destination,version:'0.3.0'};
  }
  mkdirSync(parent,{recursive:true});
  const stage=mkdtempSync(join(parent,'.cyz-workflow-install-'));
  for(const [name,data] of verified){const path=join(stage,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,data,{flag:'wx'});}
  // Atomic publication; if another installer wins, fail without touching its files.
  renameSync(stage,destination);
  return {status:'installed' as const,destination,version:'0.3.0'};
}
