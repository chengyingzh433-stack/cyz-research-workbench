import React,{useEffect,useState} from 'react';
import {emptyMatrix,matrixHeaders,parseMatrix,serializeMatrix} from '../../../../packages/workflow-adapter/src/matrix.ts';
import './matrix.css';
type Props={projectId:string;onNotice:(message:string)=>void;onDirty:(dirty:boolean)=>void;onSaved:()=>Promise<unknown>};
async function value(promise:Promise<any>){const result=await promise;if(!result.ok)throw new Error(result.error);return result.value}
export function MatrixEditor({projectId,onNotice,onDirty,onSaved}:Props){
  const [source,setSource]=useState(''),[base,setBase]=useState<string|null>(null),[hash,setHash]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[raw,setRaw]=useState(false),[selected,setSelected]=useState(-1);
  const parsed=parseMatrix(source),sourceMode=raw||parsed.mode==='source';
  useEffect(()=>{
    let cancelled=false;setLoading(true);setSelected(-1);setRaw(false);
    void value(window.cyz.matrix.read(projectId)).then(data=>{if(cancelled)return;setSource(data.hash===null?emptyMatrix:data.text);setBase(data.versionId);setHash(data.hash);setLoading(false);onDirty(false)}).catch(error=>{if(!cancelled)onNotice(error.message)});
    return ()=>{cancelled=true};
  },[projectId]);
  function change(next:string){setSource(next);onDirty(true)}
  function update(index:number,text:string){if(parsed.mode!=='table')return;try{const rows=parsed.rows.map(row=>[...row]);rows[selected][index]=text;change(serializeMatrix(parsed,rows))}catch{onNotice('表格单元格暂不支持竖线、脚注或换行标记；请切换“源码编辑”保留这些内容。')}}
  function add(){if(parsed.mode!=='table')return;const row=matrixHeaders.map(()=> '');row[12]='未知';row[14]='待核查';row[15]='未知';change(serializeMatrix(parsed,[...parsed.rows,row]));setSelected(parsed.rows.length)}
  async function save(){
    setSaving(true);
    try{
      const result=await value(window.cyz.matrix.save(projectId,source,base,hash));
      if(result.status==='conflict'){onNotice('证据矩阵在外部已变化，原文与本次候选均已保留；未覆盖原文。');return}
      const current=await value(window.cyz.matrix.read(projectId));setBase(current.versionId);setHash(current.hash);setSource(current.text);onDirty(false);await onSaved();onNotice('证据矩阵已保存，新旧版本均已保留。');
    }catch(error){onNotice(error instanceof Error?error.message:'证据矩阵保存失败')}finally{setSaving(false)}
  }
  if(loading)return <p className="muted">正在读取证据矩阵…</p>;
  return <section className="matrix-editor"><div className="toolbar"><strong>文献证据矩阵</strong><div className="button-group"><button onClick={()=>setRaw(!raw)} disabled={parsed.mode==='source'}>{sourceMode?'表格编辑':'源码编辑'}</button><button className="primary" disabled={saving} onClick={()=>void save()}>{saving?'正在保存…':'保存证据矩阵'}</button></div></div>
    <p className="muted">原文位置不清楚就保留“未知”。记录了发现，不等于已经核验全文。</p>
    {sourceMode?<>{parsed.mode==='source'&&<p className="matrix-warning">{parsed.reason}</p>}<textarea className="draft-editor" aria-label="证据矩阵 Markdown" value={source} onChange={e=>change(e.target.value)}/></>:<>
      <div className="toolbar"><span>{parsed.rows.length} 条文献记录</span><button onClick={add}>添加文献条目</button></div>
      <div className="matrix-scroll"><table><thead><tr>{[0,1,9,14,15].map(index=><th key={index}>{matrixHeaders[index]}</th>)}<th>操作</th></tr></thead><tbody>{parsed.rows.map((row,index)=><tr key={index}>{[0,1,9,14,15].map(column=><td key={column} title={row[column]}>{row[column]||'—'}</td>)}<td><button onClick={()=>setSelected(index)}>编辑 {row[0]||index+1}</button></td></tr>)}</tbody></table></div>
      {selected>=0&&parsed.rows[selected]&&<div className="matrix-fields"><h3>编辑第 {selected+1} 条记录</h3>{matrixHeaders.map((label,index)=><label key={label} htmlFor={'matrix-'+index}>{label}<input id={'matrix-'+index} value={parsed.rows[selected][index]} onChange={e=>update(index,e.target.value)}/></label>)}</div>}
    </>}
  </section>;
}
