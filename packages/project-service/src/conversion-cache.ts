import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {projectPath} from './path-policy.ts';

export type CacheFile={relpath:string;sha256:string};
export function cacheFiles(root:string):CacheFile[]{
  const files:CacheFile[]=[];let total=0,visited=0;
  function walk(prefix:string,depth:number){
    if(depth>8)throw new Error('CACHE_TOO_LARGE');
    const directory=prefix?projectPath(root,prefix):root;
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      if(++visited>5000)throw new Error('CACHE_TOO_LARGE');
      const relpath=prefix?prefix+'/'+entry.name:entry.name;
      if(entry.isSymbolicLink())throw new Error('INVALID_PATH');
      const path=projectPath(root,relpath);
      if(entry.isDirectory()){walk(relpath,depth+1);continue}
      if(!entry.isFile())throw new Error('INVALID_PATH');
      const size=statSync(path).size;total+=size;
      if(size>20_000_000||total>256_000_000)throw new Error('CACHE_TOO_LARGE');
      const bytes=readFileSync(path);
      if(bytes.length!==size)throw new Error('CACHE_INTEGRITY_ERROR');
      files.push({relpath,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
  }
  walk('',0);return files.sort((a,b)=>a.relpath<b.relpath?-1:a.relpath>b.relpath?1:0);
}
