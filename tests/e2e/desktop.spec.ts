import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp,writeFile,readFile,mkdir } from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {ProjectService} from '../../packages/project-service/src/project.ts';
import {prepareTask} from '../../packages/project-service/src/tasks.ts';
import {emptyMatrix} from '../../packages/workflow-adapter/src/matrix.ts';
test('creates a Chinese-path project and saves a draft across reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cyz 界面测试 '));
  const app = await electron.launch({args:[resolve('dist/main.cjs')],env:{...process.env,CYZ_PROJECT_ROOT:root},timeout:30000});
  const page = await app.firstWindow();
  await expect(page.getByRole('heading',{name:'研究项目'})).toBeVisible();
  await expect(page.getByRole('button',{name:'S8 全文审查与正式输出'})).toBeVisible();
  await page.getByRole('button',{name:'草稿编辑',exact:true}).click();
  await page.getByLabel('草稿内容').fill('# 我的研究\n\n保留人工修改。');
  await page.getByRole('button',{name:'保存新版本'}).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByLabel('草稿内容').fill('第二版内容');
  await page.getByRole('button',{name:'保存新版本'}).click();
  await page.getByRole('button',{name:'版本记录',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看此版本'})).toHaveCount(2);
  await page.getByRole('button',{name:'查看此版本'}).first().click();
  await expect(page.getByLabel('历史版本内容')).toHaveValue('# 我的研究\n\n保留人工修改。');
  await page.getByRole('button',{name:'将此版本载入草稿'}).click();
  await expect(page.getByLabel('草稿内容')).toHaveValue('# 我的研究\n\n保留人工修改。');
  await page.getByRole('button',{name:'保存新版本'}).click();
  await page.getByRole('button',{name:'版本记录',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看此版本'})).toHaveCount(3);
  await page.screenshot({path:'.tmp/desktop-history.png'});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,680));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=globalThis.innerWidth)).toBe(true);
  await page.screenshot({path:'.tmp/desktop-narrow.png'});
  await app.close();
  const reopened = await electron.launch({args:[resolve('dist/main.cjs')],env:{...process.env,CYZ_PROJECT_ROOT:root},timeout:30000});
  const window = await reopened.firstWindow();
  await window.getByRole('button',{name:'草稿编辑',exact:true}).click();
  await expect(window.getByLabel('草稿内容')).toHaveValue('# 我的研究\n\n保留人工修改。');
  await expect(window.getByText('尚未发起研究任务')).toBeVisible();
  await reopened.close();
});

test('reviews a run candidate before publishing it into the project',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyz 候选界面 '));
  const service=await ProjectService.create(root);
  await service.saveArtifact('07-论文草稿/工作台草稿.md','人工原稿',null);
  const task=await prepareTask(service,'S7','界面测试夹具，不调用模型');
  await writeFile(join(task.cwd,'07-论文草稿/工作台草稿.md'),'待审核候选稿');
  service.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(task.taskId);service.close();
  const app=await electron.launch({args:[resolve('dist/main.cjs')],env:{...process.env,CYZ_PROJECT_ROOT:root}});
  try{
    const page=await app.firstWindow();await page.getByRole('button',{name:'研究成果',exact:true}).click();
    await expect(page.getByLabel('候选成果内容')).toHaveValue('待审核候选稿');
    expect(await readFile(join(root,'07-论文草稿/工作台草稿.md'),'utf8')).toBe('人工原稿');
    await page.getByRole('button',{name:'确认保存为新版本'}).click();
    await expect(page.getByRole('status')).toContainText('候选成果已保存');
    expect(await readFile(join(root,'07-论文草稿/工作台草稿.md'),'utf8')).toBe('待审核候选稿');
  }finally{await app.close()}
});

test('shows an unresolved task without silently starting another model turn',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyz 恢复界面 '));const service=await ProjectService.create(root);
  await prepareTask(service,'S0','没有会话记录的中断测试');service.close();
  const app=await electron.launch({args:[resolve('dist/main.cjs')],env:{...process.env,CYZ_PROJECT_ROOT:root}});
  try{
    const page=await app.firstWindow();
    await expect(page.getByRole('button',{name:'核实任务状态'})).toBeVisible();
    await page.getByRole('button',{name:'核实任务状态'}).click();
    await expect(page.getByRole('status')).toContainText('没有记录到会话编号');
    await page.getByLabel('研究指令').fill('不应自动发起');
    await expect(page.getByRole('button',{name:'开始研究 ↑'})).toBeDisabled();
  }finally{await app.close()}
  const reopened=await ProjectService.open(root);try{expect(reopened.snapshot().tasks).toHaveLength(1)}finally{reopened.close()}
});

test('edits the existing evidence matrix without dropping surrounding notes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyz 矩阵界面 '));const service=await ProjectService.create(root);service.close();
  await writeFile(join(root,'03-文献证据矩阵.md'),emptyMatrix+'\n## 人工备注\n必须保留这段。\n');
  const app=await electron.launch({args:[resolve('dist/main.cjs')],env:{...process.env,CYZ_PROJECT_ROOT:root}});
  try{
    const page=await app.firstWindow();await page.getByRole('button',{name:'证据矩阵',exact:true}).click();
    await page.getByRole('button',{name:'添加文献条目'}).click();
    await page.getByLabel('文献 ID',{exact:true}).fill('P-001');await page.getByLabel('主要发现',{exact:true}).fill('合成测试条目，未经学术核查');
    await page.getByRole('button',{name:'保存证据矩阵'}).click();
    await expect(page.getByRole('status')).toContainText('证据矩阵已保存');
    await expect(page.locator('.summary > div').nth(1).getByText('1',{exact:true})).toBeVisible();
    const content=await readFile(join(root,'03-文献证据矩阵.md'),'utf8');expect(content).toContain('P-001');expect(content).toContain('必须保留这段。');
    await page.getByRole('button',{name:'文献材料',exact:true}).click();await page.getByRole('button',{name:'证据矩阵',exact:true}).click();
    await expect(page.getByRole('cell',{name:'P-001',exact:true})).toBeVisible();
    await page.screenshot({path:'.tmp/desktop-matrix.png'});
  }finally{await app.close()}
});

test('reads only an integrity-checked parsed cache associated with the source',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyz 阅读界面 '));const service=await ProjectService.create(root);
  const file=join(root,'合成原件.pdf');await writeFile(file,'%PDF test fixture');const source=await service.importSource(file);
  const id=randomUUID(),cache=join(root,'.cyz/conversions',id,'cache');await mkdir(cache,{recursive:true});
  const paper='# 合成解析样例\n\n## PDF 第 1 页\n\n只用于界面测试。';const map=JSON.stringify({pdf_sha256:source.sha256,pages:[{pdf_page:1}]});
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  await writeFile(join(cache,'paper.md'),paper);await writeFile(join(cache,'source_map.json'),map);
  service.db.prepare('INSERT INTO conversions(id,sourceId,status,paperHash,mapHash,createdAt) VALUES(?,?,?,?,?,?)').run(id,source.id,'completed',hash(paper),hash(map),new Date().toISOString());service.close();
  const app=await electron.launch({args:[resolve('dist/main.cjs')],env:{...process.env,CYZ_PROJECT_ROOT:root}});
  try{
    const page=await app.firstWindow();await page.getByRole('button',{name:'查看解析结果'}).click();
    await expect(page.getByLabel('解析文字')).toHaveValue(paper);
    await expect(page.getByText('全文解析 · 1 页')).toBeVisible();
    await page.screenshot({path:'.tmp/desktop-reading.png'});
  }finally{await app.close()}
});
