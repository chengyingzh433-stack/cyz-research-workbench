import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {ProjectService} from '../../packages/project-service/src/project.ts';
import {prepareTask} from '../../packages/project-service/src/tasks.ts';
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
