import {app,BrowserWindow,ipcMain,dialog,shell,Tray,Menu,nativeImage} from 'electron';
import {join,resolve} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ProjectService} from '../../../../packages/project-service/src/project.ts';
import {prepareTask} from '../../../../packages/project-service/src/tasks.ts';
import {listCandidates,publishCandidate} from '../../../../packages/project-service/src/candidates.ts';
import {reconcileTask} from '../../../../packages/project-service/src/recovery.ts';
import {readDocument,saveDocument} from '../../../../packages/project-service/src/documents.ts';
import {startConversion,pollConversion,approveSample,readConversion,listConversions,reconcileConversion} from '../../../../packages/project-service/src/conversions.ts';
import {DeskClient,findDesk} from '../../../../packages/mineru-adapter/src/client.ts';
import {projectPath} from '../../../../packages/project-service/src/path-policy.ts';
import {CodexEngine} from '../../../../packages/codex-adapter/src/engine.ts';
import type {ResearchEvent} from '../../../../packages/codex-adapter/src/normalize.ts';

let window:BrowserWindow;
let project:ProjectService|undefined;
let engine:CodexEngine|undefined;
let taskId:string|undefined;
let active=false;
let pendingOperations=0;
let deskClient:Promise<DeskClient>|undefined;
function desk(){return deskClient??=(findDesk().then(root=>new DeskClient(root)).catch(error=>{deskClient=undefined;throw error}))}
async function parsingOperation<T>(operation:()=>Promise<T>){pendingOperations++;try{return await operation()}finally{pendingOperations--}}
let quitting=false;
let tray:Tray|undefined;
const text=(value:unknown,max=10000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('INVALID_INPUT');return value};
function current(id:unknown){if(!project||project.metadata.projectId!==id)throw new Error('PROJECT_MISMATCH');return project}
function send(event:ResearchEvent){if(!window?.isDestroyed())window.webContents.send('cyz:event',{...event,projectId:project?.metadata.projectId,taskId})}
function runtimeEvent(event:ResearchEvent){
  if(!project||!taskId)return;
  if(event.type==='session.started')project.db.prepare('UPDATE tasks SET threadId=? WHERE id=?').run(event.payload.threadId,taskId);
  if(event.type==='task.status.changed'){
    project.db.prepare('UPDATE tasks SET status=?,turnId=COALESCE(?,turnId) WHERE id=?').run(event.payload.status,event.payload.turnId??null,taskId);
    if(['completed','interrupted','failed'].includes(String(event.payload.status)))active=false;
  }
  if(event.type==='recovery.required'){project.db.prepare("UPDATE tasks SET status='reconciling' WHERE id=?").run(taskId);active=false;}
  if(event.type!=='message.delta')project.emit(event.type,{...event.payload,taskId});
  send(event);
}

async function openProject(root:string){
  if(active||pendingOperations)throw new Error('请等待当前操作结束，再切换项目');
  if(project?.root===resolve(root))return {...project.snapshot(),events:project.eventsAfter(0)};
  let next:ProjectService;
  if(!existsSync(join(root,'.cyz/project.json'))){
    const skill=join(process.env.USERPROFILE??'','.codex/skills/cyz-edu-research');
    if(existsSync(join(skill,'scripts/init_project.py'))&&!existsSync(join(root,'00-项目状态.md'))){
      await promisify(execFile)('py',['-3.11',join(skill,'scripts/init_project.py'),root,'--entry-mode','discovery','--allow-existing'],{windowsHide:true,encoding:'utf8'});
    }
    next=await ProjectService.create(root);
  }else next=await ProjectService.open(root);
  const previous=project;project=next;taskId=undefined;engine?.close();engine=undefined;previous?.close();
  project.db.prepare("UPDATE tasks SET status='reconciling' WHERE status IN ('queued','running','waiting_user','stopping')").run();
  project.db.prepare("UPDATE conversions SET status=CASE WHEN status='preparing' THEN 'failed' ELSE 'reconciling' END WHERE status IN ('preparing','sample_submitting','full_submitting')").run();
  return {...project.snapshot(),events:project.eventsAfter(0)};
}

function handler(name:string,fn:(...args:any[])=>unknown){
  ipcMain.handle('cyz:'+name,async(event,...args)=>{
    if(event.sender!==window.webContents||event.senderFrame!==event.sender.mainFrame)throw new Error('UNAUTHORIZED_FRAME');
    try{return {ok:true,value:await fn(...args)}}catch(error){return {ok:false,error:error instanceof Error?error.message:'操作失败'}}
  });
}

async function setup(){
  handler('project.snapshot',()=>project?{...project.snapshot(),events:project.eventsAfter(0)}:null);
  handler('project.choose',async()=>{const result=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory'],title:'选择研究项目文件夹'});if(result.canceled)return null;return openProject(result.filePaths[0]);});
  handler('source.import',(id:unknown)=>parsingOperation(async()=>{const service=current(id);const result=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections'],filters:[{name:'研究材料',extensions:['pdf','md','txt','png','jpg','jpeg']}]});if(result.canceled)return [];const results=[];for(const path of result.filePaths)results.push(await service.importSource(path));return results;}));
  handler('source.open',async(id:unknown,sourceId:unknown)=>{const service=current(id);const source=service.snapshot().sources.find(s=>s.id===text(sourceId));if(!source)throw new Error('SOURCE_NOT_FOUND');const error=await shell.openPath(projectPath(service.root,source.relpath));if(error)throw new Error('无法打开材料');});
  handler('artifact.read',(id:unknown,path:unknown)=>{const service=current(id);const relpath=text(path,220);const file=projectPath(service.root,relpath);const artifact=service.snapshot().artifacts.find(a=>a.relpath===relpath);return {text:existsSync(file)?readFileSync(file,'utf8'):'',versionId:artifact?.currentVersionId??null};});
  handler('artifact.save',(id:unknown,path:unknown,content:unknown,base:unknown)=>{if(typeof content!=='string'||content.length>5_000_000||(base!==null&&typeof base!=='string'))throw new Error('INVALID_INPUT');return current(id).saveArtifact(text(path,220),content,base);});
  handler('artifact.history',(id:unknown,path:unknown)=>current(id).history(text(path,220)));
  handler('artifact.version',(id:unknown,version:unknown)=>current(id).readVersion(text(version,100)));
  handler('matrix.read',(id:unknown)=>readDocument(current(id),'03-文献证据矩阵.md'));
  handler('matrix.save',(id:unknown,content:unknown,base:unknown,hash:unknown)=>{
    if(typeof content!=='string'||content.length>5_000_000||(base!==null&&typeof base!=='string')||(hash!==null&&(typeof hash!=='string'||!/^\w{64}$/.test(hash))))throw new Error('INVALID_INPUT');
    return saveDocument(current(id),'03-文献证据矩阵.md',content,base,hash);
  });
  handler('parsing.list',(id:unknown)=>listConversions(current(id)));
  handler('parsing.reconcile',(id:unknown,target:unknown)=>{const service=current(id);return parsingOperation(async()=>reconcileConversion(service,text(target,100),await desk()))});
  handler('parsing.read',(id:unknown,target:unknown)=>readConversion(current(id),text(target,100)));
  handler('parsing.start',(id:unknown,source:unknown)=>{const service=current(id);return parsingOperation(async()=>startConversion(service,text(source,100),await desk()))});
  handler('parsing.poll',(id:unknown,target:unknown)=>{const service=current(id);return parsingOperation(async()=>pollConversion(service,text(target,100),await desk()))});
  handler('parsing.approve',(id:unknown,target:unknown)=>{const service=current(id);return parsingOperation(async()=>approveSample(service,text(target,100),await desk()))});
  handler('candidate.list',(id:unknown,task:unknown)=>listCandidates(current(id),text(task,100)));
  handler('candidate.publish',(id:unknown,task:unknown,path:unknown,hash:unknown)=>publishCandidate(current(id),text(task,100),text(path,220),text(hash,64)));
  handler('task.start',async(id:unknown,stage:unknown,prompt:unknown)=>{
    const service=current(id);if(active||pendingOperations)throw new Error('请等待当前操作结束');if(typeof stage!=='string'||!/^S[0-8]$/.test(stage))throw new Error('INVALID_STAGE');const message=text(prompt,30000);
    active=true;
    try{
      const prepared=await prepareTask(service,stage,message);taskId=prepared.taskId;
      engine?.close();engine=new CodexEngine(event=>{if(project===service&&taskId===prepared.taskId)runtimeEvent(event)});
      void engine.start(prepared.cwd,message).catch(()=>{});
      return {taskId};
    }catch(error){active=false;throw error;}
  });
  handler('task.stop',async(id:unknown)=>{current(id);if(!engine||!active)throw new Error('没有正在运行的任务');await engine.stop();});
  handler('task.reconcile',async(id:unknown,target:unknown)=>{
    const service=current(id);if(active)throw new Error('请等待当前操作结束');
    const ownedTask=text(target,100);active=true;const inspector=new CodexEngine(()=>{});
    try{return await reconcileTask(service,ownedTask,thread=>inspector.inspect(thread))}
    finally{inspector.close();active=false}
  });
  handler('decision.answer',(id:unknown,request:unknown,revision:unknown,answer:unknown)=>{current(id);if(!engine||typeof revision!=='number')throw new Error('DECISION_EXPIRED');engine.answer(text(request),revision,answer);});

  window=new BrowserWindow({width:1480,height:940,minWidth:980,minHeight:680,backgroundColor:'#f5f6f3',show:false,webPreferences:{preload:join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.on('close',event=>{if((active||pendingOperations)&&!quitting){event.preventDefault();window.hide();}});
  await window.loadFile(join(__dirname,'renderer/index.html'));
  window.show();
  tray=new Tray(nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='));
  tray.setToolTip('CYZ 研究工作台');tray.on('click',()=>window.show());
  tray.setContextMenu(Menu.buildFromTemplate([{label:'显示工作台',click:()=>window.show()},{label:'退出',click:async()=>{if(active){const choice=await dialog.showMessageBox(window,{type:'question',message:'研究任务仍在运行',buttons:['后台继续','停止任务'],defaultId:0,cancelId:0});if(choice.response===1){await engine?.stop();window.show();}return;}quitting=true;app.quit();}}]));
}

app.whenReady().then(async()=>{if(process.env.CYZ_PROJECT_ROOT)await openProject(process.env.CYZ_PROJECT_ROOT);await setup();}).catch(error=>{console.error(error instanceof Error?error.message:'STARTUP_FAILED');app.exit(1)});
app.on('window-all-closed',()=>{if(!active)app.quit()});
app.on('before-quit',event=>{
  if(pendingOperations){
    event.preventDefault();quitting=false;
    if(window&&!window.isDestroyed()){window.show();void dialog.showMessageBox(window,{type:'info',message:'本地操作尚未结束，请稍后再退出',detail:'正在处理材料或保存解析状态。工作台不会取消 MinerU 中的任务。',buttons:['知道了']});}
    return;
  }
  quitting=true;engine?.close();project?.close();tray?.destroy();
});
