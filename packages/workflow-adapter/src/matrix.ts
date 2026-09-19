export const matrixHeaders=['文献 ID','主题','RQ','理论/构念','对象与情境','样本','设计','数据/工具','分析','主要发现','局限','质量画像','访问级别','与本研究关系','证据状态','原文位置'];
export type MatrixDocument={mode:'source';source:string;reason:string}|{mode:'table';source:string;rows:string[][];prefix:string;suffix:string;newline:string};
const unsupported=(value:string)=>/[\r\n|]|<br\s*\/?\s*>|\[\^/i.test(value);
export function parseMatrix(source:string):MatrixDocument{
  const fallback:MatrixDocument={mode:'source',source,reason:'存在未知列、脚注或复杂单元格，请编辑 Markdown 源码，避免丢失内容。'};
  const newline=source.includes('\r\n')?'\r\n':'\n';const lines=source.split(newline);
  const start=lines.findIndex(line=>line.trim().startsWith('|'));if(start<0)return fallback;
  const cells=(line:string)=>line.trim().startsWith('|')&&line.trim().endsWith('|')?line.trim().slice(1,-1).split('|').map(cell=>cell.trim()):[];
  const header=cells(lines[start]);if(header.length!==matrixHeaders.length||header.some((h,i)=>h!==matrixHeaders[i]))return fallback;
  const separator=cells(lines[start+1]??'');if(separator.length!==header.length||separator.some(c=>!/^:?-{3,}:?$/.test(c)))return fallback;
  const rows:string[][]=[];let end=start+2;
  while(end<lines.length&&lines[end].trim().startsWith('|')){
    const row=cells(lines[end]);if(row.length!==header.length||row.some(unsupported)||lines[end].includes('\\|'))return fallback;
    rows.push(row);end++;
  }
  return {mode:'table',source,rows,newline,prefix:lines.slice(0,start+2).join(newline)+newline,suffix:end<lines.length?newline+lines.slice(end).join(newline):''};
}
export function serializeMatrix(document:MatrixDocument,rows:string[][]):string{
  if(document.mode!=='table')throw new Error('MATRIX_SOURCE_MODE');
  if(rows.some(row=>row.length!==matrixHeaders.length||row.some(unsupported)))throw new Error('MATRIX_CELL_UNSUPPORTED');
  if(JSON.stringify(rows)===JSON.stringify(document.rows))return document.source;
  return document.prefix+rows.map(row=>'| '+row.join(' | ')+' |').join(document.newline)+document.suffix;
}
export const emptyMatrix='# 文献证据矩阵\n\n> 每项结论必须能够回到原始文献位置。摘要级证据不得冒充全文核验。\n\n| '+matrixHeaders.join(' | ')+' |\n| '+matrixHeaders.map(()=> '---').join(' | ')+' |\n\n## 主题综合\n\n### 已有共识\n\n### 分歧与条件差异\n\n### 方法和证据边界\n\n### 候选研究机会（待定向复核）\n';
