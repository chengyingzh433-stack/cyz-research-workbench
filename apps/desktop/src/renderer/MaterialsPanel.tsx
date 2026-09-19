import React,{useEffect,useRef,useState} from 'react';
import './materials.css';
type Source={id:string;name:string;bytes:number};
type Job={id:string;sourceId:string;status:string};
type Reading={job:Job;scope:string;text:string;pages:{pdf_page:number}[]};
const statuses:Record<string,string>={preparing:'正在检查解析环境',sample_submitting:'正在提交样本',sample_running:'样本解析中',sample_review:'样本等待核对',full_submitting:'正在提交全文',full_running:'全文解析中',finalizing:'正在整理解析缓存',completed:'全文解析完成',failed:'解析失败',reconciling:'提交状态待核实'};
const messages:Record<string,string>={MINERU_COMMAND_FAILED:'本地解析程序调用失败，请检查 MinerU Desk 的运行记录。',MINERU_MODELS_MISSING:'本机缺少解析模型，尚未下载或上传文件。',MINERU_OFFLINE_REQUIRED:'请先在 MinerU Desk 开启离线模式；工作台不会替你改变共享设置。',CONVERSION_SUBMISSION_UNKNOWN:'提交响应未确认，已保留记录，不会重复提交。',CACHE_INTEGRITY_ERROR:'解析缓存发生变化，已停止读取，请检查文件。',SOURCE_CHANGED:'原件副本已变化，不能继续使用旧解析结果。'};
Object.assign(messages,{CACHE_VERIFICATION_REQUIRED:'这是缺少资产校验清单的旧解析缓存，暂不读取。原件和缓存都已保留，需要单独核验，不能直接补签。',CONVERSION_REQUEST_INVALID:'原提交记录缺失或不匹配，无法安全核实。已保留当前状态，不会重新提交。'});
async function value(promise:Promise<any>){const result=await promise;if(!result.ok)throw new Error(messages[result.error]??result.error);return result.value}
export function MaterialsPanel({projectId,sources,onNotice,onSaved}:{projectId:string;sources:Source[];onNotice:(text:string)=>void;onSaved:()=>Promise<unknown>}){
  const [jobs,setJobs]=useState<Job[]>([]),[working,setWorking]=useState(''),[reading,setReading]=useState<Reading|null>(null);
  const reader=useRef<HTMLTextAreaElement>(null);
  async function reload(){setJobs(await value(window.cyz.parsing.list(projectId)))}
  async function action(id:string,work:()=>Promise<void>){setWorking(id);try{await work();await reload()}catch(error){onNotice(error instanceof Error?error.message:'操作失败');await reload().catch(()=>{})}finally{setWorking('')}}
  useEffect(()=>{setReading(null);void reload().catch(error=>onNotice(error.message))},[projectId]);
  function jump(page:number){if(!reading||!reader.current)return;const marker='## PDF 第 '+page+' 页';const index=reading.text.indexOf(marker);if(index<0){onNotice('解析文字中未找到该页的可靠定位标记。');return}reader.current.focus();reader.current.setSelectionRange(index,index+marker.length);reader.current.scrollTop=reading.text.slice(0,index).split('\n').length/reading.text.split('\n').length*reader.current.scrollHeight}
  async function show(job:Job){const result=await value(window.cyz.parsing.read(projectId,job.id));setReading({job,...result})}
  return <><div className="toolbar"><strong>项目材料</strong><button disabled={!!working} onClick={()=>void action('import',async()=>{const results=await value(window.cyz.sources.import(projectId));await onSaved();onNotice(`已处理 ${results.length} 份材料`)})}>＋ 导入材料</button></div>
  {sources.length?sources.map(source=>{
    const job=jobs.filter(j=>j.sourceId===source.id).at(-1);
    return <article className="material" key={source.id}><div className="file-icon">{source.name.split('.').at(-1)?.toUpperCase()}</div><div><h3>{source.name}</h3><p>{(source.bytes/1024).toFixed(1)} KB · 原件副本已保存</p><span className="badge">{working===source.id?'正在检查解析环境…':job?statuses[job.status]??job.status:'等待解析与阅读'}</span></div><div className="material-actions"><button onClick={()=>void action(source.id,async()=>{await value(window.cyz.sources.open(projectId,source.id))})}>查看原件</button>
    {source.name.toLowerCase().endsWith('.pdf')&&(!job||job.status==='failed')&&<button disabled={!!working} onClick={()=>void action(source.id,async()=>{await value(window.cyz.parsing.start(projectId,source.id));onNotice('已提交本地小样本，尚未解析全文。')})}>本地解析</button>}
    {job&&['sample_running','full_running','finalizing'].includes(job.status)&&<button disabled={!!working} onClick={()=>void action(source.id,async()=>{await value(window.cyz.parsing.poll(projectId,job.id))})}>刷新解析进度</button>}
    {job?.status==='reconciling'&&<button disabled={!!working} onClick={()=>void action(source.id,async()=>{const result=await value(window.cyz.parsing.reconcile(projectId,job.id));onNotice(result.status==='reconciling'?'尚未找到唯一匹配任务，已保留记录，不会重新提交。':'已找回原解析任务，可刷新解析进度。')})}>核实解析状态</button>}
    {job&&['sample_review','completed'].includes(job.status)&&<button disabled={!!working} onClick={()=>void action(source.id,()=>show(job))}>{job.status==='completed'?'查看解析结果':'检查解析样本'}</button>}
    </div></article>
  }):<div className="empty"><h2>先放进一份研究材料</h2><p>支持 PDF、Markdown、文本和图片。重复内容会复用，同名的不同文件会分开保存。</p></div>}
  {reading&&<section className="reading"><div className="toolbar"><strong>{reading.scope==='sample'?'仅小样本，尚未解析全文':`全文解析 · ${reading.pages.length} 页`}</strong><button onClick={()=>setReading(null)}>收起解析结果</button></div><p className="muted">解析文字用于阅读辅助，重要数字、公式和引文仍需对照原件核查。没有可靠页码时不会猜测定位。</p>
    {reading.scope==='full'&&<label>跳转到解析中的 PDF 页 <select aria-label="解析页码" onChange={e=>jump(Number(e.target.value))}><option value="">选择页码</option>{reading.pages.map(page=><option key={page.pdf_page} value={page.pdf_page}>{page.pdf_page}</option>)}</select></label>}
    <textarea ref={reader} className="draft-editor" aria-label="解析文字" readOnly value={reading.text}/>
    {reading.scope==='sample'&&<button className="primary" disabled={!!working} onClick={()=>void action(reading.job.sourceId,async()=>{await value(window.cyz.parsing.approve(projectId,reading.job.id));setReading(null);onNotice('已按你的确认提交全文解析，原件不会改动。')})}>样本已核对，继续全文解析</button>}
  </section>}
  <p className="muted">解析使用本机 MinerU Desk，不自动上传或下载模型。解析期间可刷新进度；提交状态未知时不会重交。</p></>;
}
