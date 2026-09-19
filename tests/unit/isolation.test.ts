import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {assertIsolation,runSandbox} from '../../packages/codex-adapter/src/isolation.ts';
it('limits writes to the run directory and excludes implicit temporary roots',()=>{
  const policy=runSandbox('test-run');
  expect(policy).toMatchObject({type:'workspaceWrite',writableRoots:[resolve('test-run')],excludeTmpdirEnvVar:true,excludeSlashTmp:true});
});
it('rejects broader writable roots or an incorrect working directory',()=>{
  const cwd=resolve('test-run');
  expect(()=>assertIsolation(cwd,{cwd,sandbox:{...runSandbox(cwd),writableRoots:[resolve('.')]}})).toThrow('CODEX_ISOLATION_NOT_CONFIRMED');
  expect(()=>assertIsolation(cwd,{cwd:resolve('.'),sandbox:runSandbox(cwd)})).toThrow('CODEX_ISOLATION_NOT_CONFIRMED');
  expect(()=>assertIsolation(cwd,{cwd,sandbox:runSandbox(cwd)})).not.toThrow();
});
