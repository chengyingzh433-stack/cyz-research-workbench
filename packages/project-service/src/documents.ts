import type {ProjectService} from './project.ts';
import {projectPath} from './path-policy.ts';
import {existsSync,readFileSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function readDocument(service:ProjectService,relpath:string):{text:string;versionId:string|null;hash:string|null}{
  const path=projectPath(service.root,relpath);let bytes:Buffer|null=null;
  if(existsSync(path)){if(statSync(path).size>10*1024*1024)throw new Error('DOCUMENT_TOO_LARGE');bytes=readFileSync(path);if(bytes.length>10*1024*1024)throw new Error('DOCUMENT_TOO_LARGE')}
  const artifact=service.snapshot().artifacts.find(a=>a.relpath===relpath);
  return {text:bytes?new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes):'',hash:bytes?hash(bytes):null,versionId:artifact?.currentVersionId??null};
}
export async function saveDocument(service:ProjectService,relpath:string,text:string,base:string|null,expectedHash:string|null){
  const current=readDocument(service,relpath);
  if(base===null&&current.versionId===null&&current.hash!==null&&current.hash===expectedHash&&!service.snapshot().artifacts.some(a=>a.relpath===relpath)){
    const object=projectPath(service.root,`.cyz/versions/${current.hash}`,true);mkdirSync(dirname(object),{recursive:true});
    if(!existsSync(object))writeFileSync(object,current.text,{flag:'wx'});
    if(hash(readFileSync(object))!==current.hash)throw new Error('VERSION_INTEGRITY_ERROR');
    const artifactId=randomUUID(),versionId=randomUUID();
    service.db.transaction(()=>{
      service.db.prepare('INSERT INTO artifacts(id,relpath,currentVersionId) VALUES(?,?,?)').run(artifactId,relpath,versionId);
      service.db.prepare('INSERT INTO versions(id,artifactId,hash,baseVersionId,state,createdAt) VALUES(?,?,?,?,?,?)').run(versionId,artifactId,current.hash,null,'published',new Date().toISOString());
      service.emit('artifact.adopted',{artifactId,versionId,relpath});
    })();
    base=versionId;
  }
  return service.saveArtifact(relpath,text,base,expectedHash);
}
