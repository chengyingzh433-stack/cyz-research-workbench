import {test,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {installBundledWorkflow} from '../../packages/workflow-adapter/src/bundled-workflow.ts';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'cyz-bundle-test-'));
  const bundle=join(root,'bundle');mkdirSync(join(bundle,'cyz-edu-research'),{recursive:true});
  const files={'SKILL.md':'workflow','VERSION':'0.3.0\n'};
  for(const [name,content] of Object.entries(files))writeFileSync(join(bundle,'cyz-edu-research',name),content);
  const manifest={version:'0.3.0',files:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,createHash('sha256').update(content).digest('hex')]))};
  writeFileSync(join(bundle,'manifest.json'),JSON.stringify(manifest));
  return {root,bundle,home:join(root,'codex'),manifest};
}
test('installs offline into requested Codex home, then reuses identical files',()=>{
  const f=fixture();expect(installBundledWorkflow(f.bundle,f.home).status).toBe('installed');
  expect(readFileSync(join(f.home,'skills/cyz-edu-research/SKILL.md'),'utf8')).toBe('workflow');
  expect(installBundledWorkflow(f.bundle,f.home).status).toBe('already_verified');
});
test('preserves local modifications and reports conflict',()=>{
  const f=fixture();installBundledWorkflow(f.bundle,f.home);
  const path=join(f.home,'skills/cyz-edu-research/SKILL.md');writeFileSync(path,'my changes');
  expect(()=>installBundledWorkflow(f.bundle,f.home)).toThrow('WORKFLOW_LOCAL_CONFLICT');
  expect(readFileSync(path,'utf8')).toBe('my changes');
});
test('rejects damaged resource before creating destination',()=>{
  const f=fixture();writeFileSync(join(f.bundle,'cyz-edu-research/SKILL.md'),'damaged');
  expect(()=>installBundledWorkflow(f.bundle,f.home)).toThrow('BUNDLE_HASH_MISMATCH');
  expect(existsSync(join(f.home,'skills/cyz-edu-research'))).toBe(false);
});
test.each(['../escape','C:/escape','a\\b','a:stream','a/../b'])('rejects unsafe inventory path %s',(name)=>{
  const f=fixture();f.manifest.files[name]='a'.repeat(64);writeFileSync(join(f.bundle,'manifest.json'),JSON.stringify(f.manifest));
  expect(()=>installBundledWorkflow(f.bundle,f.home)).toThrow('BUNDLE_INVALID');
  expect(existsSync(f.home)).toBe(false);
});
test('rejects unlisted bundled files',()=>{
  const f=fixture();writeFileSync(join(f.bundle,'cyz-edu-research/extra'),'unlisted');
  expect(()=>installBundledWorkflow(f.bundle,f.home)).toThrow('BUNDLE_INVALID');
});
