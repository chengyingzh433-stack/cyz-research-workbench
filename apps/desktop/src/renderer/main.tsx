import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import {MatrixEditor} from './MatrixEditor.tsx';
import {MaterialsPanel} from './MaterialsPanel.tsx';

declare global {interface Window {cyz:any}}
const api=window.cyz;
type Snapshot={project:{id:string;name:string;root:string};stages:{id:string;name:string;status:string}[];sources:{id:string;name:string;bytes:number;sha256:string}[];artifacts:any[];tasks:any[];events?:any[]};
async function call<T=any>(promise:Promise<any>):Promise<T>{const result=await promise;if(!result.ok)throw new Error(result.error);return result.value;}
const draftPath='07-论文草稿/工作台草稿.md';
const stageLabels=['领域扫描与灵感发现','实践问题与研究问题','文献检索设计','文献筛选与分级阅读','文献综合与研究缺口','研究设计','数据收集与分析','论文写作','全文审查与正式输出'];
function App(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[stage,setStage]=useState(0),[view,setView]=useState('materials');
  const [notice,setNotice]=useState(''),[chatOpen,setChatOpen]=useState(true),[draft,setDraft]=useState(''),[base,setBase]=useState<string|null>(null),[dirty,setDirty]=useState(false);
  const [prompt,setPrompt]=useState(''),[messages,setMessages]=useState<{id:string;text:string;role:string}[]>([]),[taskStatus,setTaskStatus]=useState('idle'),[decision,setDecision]=useState<any>(null),[answer,setAnswer]=useState(''),[usage,setUsage]=useState<any>(null),[history,setHistory]=useState<any[]>([]);
  const projectId=snapshot?.project.id;
  const [selectedVersion,setSelectedVersion]=useState<{id:string;text:string}|null>(null);
  const [candidateTask,setCandidateTask]=useState(''),[candidates,setCandidates]=useState<{relpath:string;text:string;sha256:string}[]>([]),[publishing,setPublishing]=useState(false);
  const [checking,setChecking]=useState(false);
  const [matrixDirty,setMatrixDirty]=useState(false);
  const busy=['queued','running','stopping','waiting_user'].includes(taskStatus);
  const safe=async(fn:()=>Promise<void>)=>{try{await fn()}catch(e){setNotice(e instanceof Error?e.message:'操作未完成')}};
  async function refresh(){const value=await call<Snapshot|null>(api.projects.snapshot());setSnapshot(value);return value}
  function hydrate(data:Snapshot|null){setMessages((data?.events??[]).filter(e=>e.type==='message.user'||e.type==='message.completed').map(e=>({id:e.eventId,text:e.payload.text,role:e.type==='message.user'?'user':'assistant'})));setTaskStatus(data?.tasks.some(t=>t.status==='reconciling')?'reconciling':data?.tasks.at(-1)?.status??'idle')}
  useEffect(()=>{void safe(async()=>hydrate(await refresh()))},[]);
  useEffect(()=>api.events.subscribe((event:any)=>{
    if(event.projectId!==projectId)return;
    const p=event.payload;
    if(event.type==='message.delta')setMessages(old=>{const found=old.find(m=>m.id===p.id);return found?old.map(m=>m.id===p.id?{...m,text:m.text+p.text}:m):[...old,{id:p.id,text:p.text,role:'assistant'}]});
    if(event.type==='message.completed')setMessages(old=>old.some(m=>m.id===p.id)?old.map(m=>m.id===p.id?{...m,text:p.text}:m):[...old,{id:p.id,text:p.text,role:'assistant'}]);
    if(event.type==='task.status.changed'){setTaskStatus(p.status);if(['completed','interrupted','failed'].includes(p.status)){void refresh();setDecision(null)}}
    if(event.type==='recovery.required'){setTaskStatus('reconciling');setNotice('运行状态需要核实：'+p.reason)}
    if(event.type==='decision.requested'){setDecision(p);setTaskStatus('waiting_user')}
    if(event.type==='decision.resolved'){setDecision(null);setTaskStatus('running')}
    if(event.type==='usage.updated')setUsage(p);
  }),[projectId]);
  async function loadDraft(){const data=await call(api.artifacts.read(projectId,draftPath));setDraft(data.text);setBase(data.versionId);setDirty(false)}
  useEffect(()=>{setSelectedVersion(null);setHistory([]);setCandidates([]);setCandidateTask('');if(projectId)void safe(loadDraft)},[projectId]);
  async function choose(){if((dirty||matrixDirty)&&!confirm('当前文档有未保存修改，是否放弃这些修改并切换项目？'))return;const data=await call(api.projects.choose());if(data){setSnapshot(data);hydrate(data);setDirty(false);setMatrixDirty(false);setDecision(null);setUsage(null)}}
  async function loadCandidates(task:string){setCandidates([]);setCandidateTask(task);if(task)setCandidates(await call(api.candidates.list(projectId,task)))}
  async function publish(item:{relpath:string;sha256:string}){setPublishing(true);try{const result=await call(api.candidates.publish(projectId,candidateTask,item.relpath,item.sha256));setNotice(result.status==='conflict'?'原稿已变化。原稿与候选稿均已保留，未覆盖原稿。':'候选成果已保存为新版本');setCandidates(old=>old.filter(c=>c.relpath!==item.relpath));await refresh()}finally{setPublishing(false)}}
  async function selectView(next:string){if(next===view)return;if((dirty||matrixDirty)&&!confirm('是否放弃当前文档尚未保存的修改？'))return;if(next==='draft'&&projectId)await loadDraft();setDirty(false);setMatrixDirty(false);setView(next);if(next==='history'&&projectId)setHistory(await call(api.artifacts.history(projectId,draftPath)));if(next==='results')await loadCandidates(snapshot?.tasks.filter(t=>t.status==='completed').at(-1)?.id??'')}
  async function restoreVersion(){if(!selectedVersion)return;const current=await call(api.artifacts.read(projectId,draftPath));setBase(current.versionId);setDraft(selectedVersion.text);setDirty(true);setView('draft');setNotice('历史内容已载入草稿，尚未覆盖当前文件。检查后点击“保存新版本”。')}
  async function start(){if(!projectId||!prompt.trim())return;if(dirty||matrixDirty){setNotice('请先保存当前文档，再开始研究。研究任务只读取已保存的成果。');return}const text=prompt;setTaskStatus('queued');try{await call(api.tasks.start(projectId,'S'+stage,text));setMessages(old=>[...old,{id:crypto.randomUUID(),role:'user',text}]);setPrompt('')}catch(error){setTaskStatus('failed');throw error}}
  async function save(){const result=await call(api.artifacts.save(projectId,draftPath,draft,base));if(result.status==='conflict'){setNotice('保存遇到版本冲突。你的候选稿和原稿均已保留，请核对版本记录。');return}setBase(result.versionId);setDirty(false);setNotice('已保存新版本');await refresh()}
  async function respond(value:unknown){await call(api.decisions.answer(projectId,decision.id,decision.revision,value));setAnswer('')}
  async function reconcile(){
    setChecking(true);
    const reasons:Record<string,string>={SESSION_NOT_RECORDED:'没有记录到会话编号，不能确认是否执行。',TURN_NOT_RECORDED:'没有记录到本轮编号，暂不能确认结果。',RUNTIME_READ_FAILED:'暂时无法读取运行记录，请稍后重试。',RUNTIME_IDENTITY_MISMATCH:'运行记录与本项目不一致，已保留原状态。',TURN_NOT_FOUND:'未找到原来的执行轮次，暂不能确认结果。',TURN_NOT_TERMINAL:'运行时尚未确认结束，未重新执行任务。'};
    try{
      const latest=await refresh();let unresolved='';
      for(const task of latest?.tasks.filter(t=>t.status==='reconciling')??[]){const result=await call(api.tasks.reconcile(projectId,task.id));if(result.status==='reconciling')unresolved=reasons[result.reason]??'仍无法确认原任务状态。'}
      hydrate(await refresh());setNotice(unresolved||'任务状态已核实，已恢复确认完成的回复。');
    }finally{setChecking(false)}
  }
  const statusText:Record<string,string>={idle:'尚未发起研究任务',queued:'准备研究任务',running:'研究进行中',waiting_user:'等待你的回答',stopping:'正在停止，等待确认',interrupted:'任务已停止',completed:'任务执行完成',failed:'任务失败',reconciling:'运行状态待核实'};
  return <><header className="app-header"><div className="brand-mark">c</div><div><strong>CYZ 研究工作台</strong><small>让研究过程与证据留在一起</small></div><div className="header-project">{snapshot?.project.name??'尚未打开项目'}</div><button onClick={()=>void safe(choose)}>打开或新建项目</button><button onClick={()=>setChatOpen(!chatOpen)}>{chatOpen?'收起对话':'展开对话'}</button></header>
  <div className={'shell '+(!chatOpen?'chat-hidden':'')}><aside className="nav"><p className="label">研究阶段</p>{stageLabels.map((name,i)=><button aria-label={'S'+i+' '+name} className={stage===i?'stage active':'stage'} key={name} onClick={()=>setStage(i)}><span>S{i}</span><span>{name}</span></button>)}<div className="rule"/><p className="label">项目资源</p><button className="stage" onClick={()=>void safe(()=>selectView('materials'))}>文献与材料</button><button className="stage" onClick={()=>void safe(()=>selectView('history'))}>版本记录</button><p className="nav-note">切换阶段只切换浏览位置。<br/>研究任务由你发起。</p></aside>
  <main><div className="breadcrumb">{snapshot?.project.name??'欢迎'}　/　S{stage}</div><h1>研究项目</h1><p className="intro">{stageLabels[stage]}。{snapshot?'先查看已有材料与成果，再决定下一步。':'选择一个本地文件夹，开始或继续你的研究。'}</p>
  {snapshot&&<><section className="summary"><div><b>{snapshot.sources.length}</b><small>已导入材料</small></div><div><b>{snapshot.artifacts.length}</b><small>已登记成果</small></div><div><span className="badge amber">研究质量待核查</span><small>任务执行完成后仍需核查证据</small></div></section><nav className="tabs"><button className={view==='materials'?'selected':''} onClick={()=>void safe(()=>selectView('materials'))}>文献材料</button><button className={view==='matrix'?'selected':''} onClick={()=>void safe(()=>selectView('matrix'))}>证据矩阵</button><button className={view==='draft'?'selected':''} onClick={()=>void safe(()=>selectView('draft'))}>草稿编辑</button><button className={view==='results'?'selected':''} onClick={()=>void safe(()=>selectView('results'))}>研究成果</button></nav>
  {view==='materials'&&<MaterialsPanel projectId={snapshot.project.id} sources={snapshot.sources} onNotice={setNotice} onSaved={refresh}/>}
  {view==='results'&&<><div className="toolbar"><strong>待审核的候选成果</strong><select aria-label="成果所属任务" value={candidateTask} onChange={e=>void safe(()=>loadCandidates(e.target.value))}><option value="">选择已完成任务</option>{snapshot.tasks.filter(t=>t.status==='completed').map(t=><option key={t.id} value={t.id}>{t.stageId} · {t.objective.slice(0,32)}</option>)}</select></div><p className="muted">这里列出任务新增或修改的 Markdown。先核查事实和引文，再确认保存；任务完成不代表学术质量已通过。</p>{candidates.length?candidates.map(item=><article key={item.relpath}><div className="toolbar"><strong>{item.relpath}</strong><button disabled={publishing} onClick={()=>void safe(()=>publish(item))}>确认保存为新版本</button></div><textarea className="draft-editor" aria-label="候选成果内容" readOnly value={item.text}/></article>):<div className="empty">没有可审核的新文件。研究对话中的回答会保留在右侧。</div>}</>}
  {view==='matrix'&&<MatrixEditor projectId={snapshot.project.id} onNotice={setNotice} onDirty={setMatrixDirty} onSaved={refresh}/>}
  {view==='draft'&&<><div className="toolbar"><strong>工作台草稿 {dirty?'· 未保存':''}</strong><button className="primary" onClick={()=>void safe(save)}>保存新版本</button></div><textarea className="draft-editor" aria-label="草稿内容" value={draft} onChange={e=>{setDraft(e.target.value);setDirty(true)}} placeholder="写下当前的研究问题、证据与论述…"/><p className="muted">保存到 {draftPath}，每次保存保留历史。</p></>}
  {view==='history'&&<><div className="toolbar"><strong>工作台草稿历史</strong></div>{history.length?history.map(v=><article className="material" key={v.id}><div><h3>{v.state==='conflict'?'待处理的冲突候选':'已保存版本'}</h3><p>{new Date(v.createdAt).toLocaleString()} · {v.hash.slice(0,12)}</p></div><button onClick={()=>void safe(async()=>setSelectedVersion({id:v.id,text:await call(api.artifacts.version(projectId,v.id))}))}>查看此版本</button></article>):<div className="empty">尚无草稿版本。</div>}{selectedVersion&&<section><div className="toolbar"><strong>历史内容预览</strong><button onClick={()=>void safe(restoreVersion)}>将此版本载入草稿</button></div><textarea className="draft-editor" aria-label="历史版本内容" readOnly value={selectedVersion.text}/><p className="muted">载入后需要手动保存，恢复会新增版本，不会删除后续版本。</p></section>}</>}
  <p className="project-path" title={snapshot.project.root}>{snapshot.project.root}</p></>}
  {!snapshot&&<div className="empty"><h2>一个文件夹，一项研究</h2><p>材料、进度与成果保存在本机。打开项目不会自动调用模型。</p><button className="primary" onClick={()=>void safe(choose)}>选择项目文件夹</button></div>}
  {taskStatus==='reconciling'&&<section className="decision"><strong>上次任务的结果尚待核实</strong><p>先读取原会话记录，不会重复发送研究指令。核实完成前保留已有草稿和材料。</p><button disabled={checking} onClick={()=>void safe(reconcile)}>{checking?'正在核实…':'核实任务状态'}</button></section>}
  <div role="status" className={'notice '+(notice?'shown':'')}>{notice}</div></main>
  {chatOpen&&<section className="chat"><div className="chat-header"><strong>研究对话</strong><span className={'badge '+(busy?'amber':'')}>{statusText[taskStatus]}</span></div><div className="messages">{messages.length?messages.map(m=><div key={m.id} className={'message '+m.role}><small>{m.role==='user'?'你':'Codex'}</small><div>{m.text}</div></div>):<div className="chat-welcome"><h2>从你现在的情况开始</h2><p>可以说一个教学困惑，或请 Codex 检查已有的研究问题。</p><button onClick={()=>setPrompt('我还没有选题，请先了解我的学科和资料条件，每次只问一个关键问题。')}>我还没有选题</button><button onClick={()=>setPrompt('请读取本项目的状态，盘点已有成果与缺少的证据，告诉我下一步。')}>继续已有研究</button></div>}
  {decision&&<div className="decision"><span className="badge amber">{decision.kind==='research'?'需要你的研究决定':'操作审批'}</span>{decision.kind==='research'?<>{(decision.questions??[]).map((q:any)=><p key={q.id}>{q.question}</p>)}<textarea aria-label="决定回答" value={answer} onChange={e=>setAnswer(e.target.value)}/><button onClick={()=>void safe(()=>respond({answers:Object.fromEntries((decision.questions??[]).map((q:any)=>[q.id,{answers:[answer]}]))}))}>提交回答</button></>:<><p>{decision.reason??'Codex 请求执行一项需要批准的操作。'}</p><button onClick={()=>void safe(()=>respond('decline'))}>拒绝</button><button onClick={()=>void safe(()=>respond('accept'))}>允许本次</button></>}</div>}</div>
  <div className="composer"><textarea aria-label="研究指令" placeholder="描述你希望推进的下一步…" value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={!snapshot}/><footer><span>S{stage} · {stageLabels[stage]}</span>{busy?<button onClick={()=>void safe(async()=>{await call(api.tasks.stop(projectId))})}>停止任务</button>:<button className="primary" disabled={!snapshot||!prompt.trim()||taskStatus==='reconciling'} onClick={()=>void safe(start)}>开始研究 ↑</button>}</footer></div><div className="usage">输入 {usage?.input??'未知'} · 输出 {usage?.output??'未知'} · 缓存读取 {usage?.cachedRead??'未知'}<br/>费用未知 · 仅显示运行时提供的用量</div></section>}</div></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
