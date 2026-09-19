import Database from 'better-sqlite3';
import {projectPath} from './path-policy.ts';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

// A separate SQLite connection holds an OS file lock for this service's lifetime.
// The OS releases it on a crash; no PID guessing or stale lock-file deletion.
function acquire(path:string):()=>void{
  const lock=new Database(path,{timeout:0});
  try{lock.exec('BEGIN EXCLUSIVE')}catch(error){
    lock.close();
    if(error&&typeof error==='object'&&'code' in error&&['SQLITE_BUSY','SQLITE_LOCKED'].includes(String(error.code)))throw new Error('PROJECT_ALREADY_OPEN');
    throw error;
  }
  return ()=>{if(lock.open)lock.close()};
}
export function acquireProjectLock(root:string,projectId:string):()=>void{
  if(!/^[0-9a-f-]{36}$/i.test(projectId))throw new Error('UNSUPPORTED_PROJECT');
  const directory=join(process.env.LOCALAPPDATA??join(homedir(),'.local','state'),'CYZ-research-workbench','locks');
  mkdirSync(directory,{recursive:true});
  const releaseIdentity=acquire(join(directory,projectId.toLowerCase()+'.sqlite'));
  try{
    const releasePath=acquire(projectPath(root,'.cyz/write-lock.sqlite',true));
    return ()=>{try{releasePath()}finally{releaseIdentity()}};
  }catch(error){releaseIdentity();throw error}
}
