import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
it('rejects an unverified deployment archive before installing anything',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyz setup '));const cache=join(root,'cache');await mkdir(cache);
  await writeFile(join(cache,'cyz-edu-research-0.3.0.zip'),'not the pinned release');
  await expect(run('py',['-3.11','scripts/setup-workflow.py','--codex-home',join(root,'codex'),'--cache',cache,'--offline'],{cwd:resolve('.')})).rejects.toMatchObject({code:2,stderr:expect.stringContaining('HASH_MISMATCH')});
  await expect(readFile(join(root,'codex/skills/cyz-edu-research/SKILL.md'))).rejects.toThrow();
});
