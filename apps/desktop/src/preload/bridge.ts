import {contextBridge,ipcRenderer} from 'electron';
const call=(method:string,...args:unknown[])=>ipcRenderer.invoke('cyz:'+method,...args);
contextBridge.exposeInMainWorld('cyz',{
  projects:{choose:()=>call('project.choose'),snapshot:()=>call('project.snapshot')},
  sources:{import:(id:string)=>call('source.import',id),open:(id:string,sourceId:string)=>call('source.open',id,sourceId)},
  artifacts:{read:(id:string,path:string)=>call('artifact.read',id,path),save:(id:string,path:string,text:string,base:string|null)=>call('artifact.save',id,path,text,base),history:(id:string,path:string)=>call('artifact.history',id,path),version:(id:string,version:string)=>call('artifact.version',id,version)},
  tasks:{start:(id:string,stage:string,prompt:string)=>call('task.start',id,stage,prompt),stop:(id:string)=>call('task.stop',id)},
  candidates:{list:(id:string,task:string)=>call('candidate.list',id,task),publish:(id:string,task:string,path:string,hash:string)=>call('candidate.publish',id,task,path,hash)},
  decisions:{answer:(id:string,request:string,revision:number,answer:unknown)=>call('decision.answer',id,request,revision,answer)},
  events:{subscribe:(listener:(data:unknown)=>void)=>{const handler=(_event:unknown,data:unknown)=>listener(data);ipcRenderer.on('cyz:event',handler);return()=>ipcRenderer.removeListener('cyz:event',handler)}},
});
