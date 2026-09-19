import {expect,it} from 'vitest';
import {matrixHeaders,parseMatrix,serializeMatrix} from '../../packages/workflow-adapter/src/matrix.ts';
const row=['P1','动机','','','','','','','','发现','','','全文','','待核查','第 3 页'];
const table=(headers=matrixHeaders,cells=row)=>'| '+headers.join(' | ')+' |\r\n| '+headers.map(()=> '---').join(' | ')+' |\r\n| '+cells.join(' | ')+' |';
it('edits only the supported table and preserves surrounding prose and another table',()=>{
  const prefix='# 文献证据矩阵\r\n\r\n> 自己的说明\r\n\r\n';const suffix='\r\n\r\n## 张力\r\n\r\n| A | B |\r\n| --- | --- |\r\n| 保留 | 不变 |\r\n';
  const source=prefix+table()+suffix;const parsed=parseMatrix(source);expect(parsed.mode).toBe('table');if(parsed.mode!=='table')throw new Error('expected table');
  expect(serializeMatrix(parsed,parsed.rows)).toBe(source);
  const changed=parsed.rows.map(r=>[...r]);changed[0][9]='修改后的发现';const output=serializeMatrix(parsed,changed);
  expect(output).toBe(prefix+table(matrixHeaders,changed[0])+suffix);
});
it.each(['unknown-column','escaped-pipe','line-break','footnote'])('falls back without losing unsupported %s content',kind=>{
  let source=table();if(kind==='unknown-column')source=table([...matrixHeaders,'自定义列'],[...row,'保留']);
  if(kind==='escaped-pipe')source=table(matrixHeaders,row.map((v,i)=>i===9?'A\\|B':v));
  if(kind==='line-break')source=table(matrixHeaders,row.map((v,i)=>i===9?'A<br>B':v));
  if(kind==='footnote')source=table(matrixHeaders,row.map((v,i)=>i===9?'结论[^1]':v));
  const parsed=parseMatrix(source);expect(parsed.mode).toBe('source');expect(parsed.source).toBe(source);
});
it('rejects cell content that would silently create another row or column',()=>{
  const parsed=parseMatrix(table());expect(()=>serializeMatrix(parsed,[row.map((v,i)=>i===9?'A | B':v)])).toThrow('MATRIX_CELL_UNSUPPORTED');
});
