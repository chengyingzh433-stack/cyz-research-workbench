import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('installed executable creates and reopens a project without Node or system Python on PATH',async()=>{
  test.skip(!process.env.CYZ_INSTALLED_EXE,'Requires the actual installed executable');
  const root=await mkdtemp(join(tmpdir(),'cyz 安装版项目 '));
  const home=process.env.CYZ_INSTALL_TEST_HOME??await mkdtemp(join(tmpdir(),'cyz-installed-codex-'));
  const env={...process.env,CODEX_HOME:home,CYZ_PROJECT_ROOT:root,PATH:join(process.env.SystemRoot??'C:\\Windows','System32')};
  const app=await electron.launch({executablePath:process.env.CYZ_INSTALLED_EXE!,args:[],env,timeout:45000});
  try{
    expect(await app.evaluate(({app})=>app.isPackaged)).toBe(true);
    const page=await app.firstWindow();
    await expect(page.getByRole('heading',{name:'研究项目'})).toBeVisible();
    await expect(page.getByRole('img',{name:'CYZ 书本图标'})).toBeVisible();
    await page.getByRole('button',{name:'草稿编辑',exact:true}).click();
    await page.getByLabel('草稿内容').fill('# 安装版验收\n\n这是一份合成测试草稿。');
    await page.getByRole('button',{name:'保存新版本'}).click();
    await expect(page.getByRole('status')).toContainText('已保存');
    expect(await readFile(join(root,'00-项目状态.md'),'utf8')).toContain('S0');
    expect((await readFile(join(home,'skills/cyz-edu-research/VERSION'),'utf8')).trim()).toBe('0.3.0');
    await page.screenshot({path:'.tmp/installed-desktop.png'});
    console.log(JSON.stringify({installedExecutable:process.env.CYZ_INSTALLED_EXE,project:root,codexHome:home}));
  }finally{await app.close();}
  const reopened=await electron.launch({executablePath:process.env.CYZ_INSTALLED_EXE!,args:[],env,timeout:45000});
  try{
    const page=await reopened.firstWindow();await page.getByRole('button',{name:'草稿编辑',exact:true}).click();
    await expect(page.getByLabel('草稿内容')).toHaveValue('# 安装版验收\n\n这是一份合成测试草稿。');
  }finally{await reopened.close();}
});
