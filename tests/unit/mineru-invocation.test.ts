import {expect,it} from 'vitest';
import {powershellInvocation,isOwnedTaskFailure} from '../../packages/mineru-adapter/src/client.ts';
it('treats paths containing quotes and shell characters as literal arguments',()=>{
  const args=powershellInvocation("C:/研究's/Codex.ps1",['submit',"C:/研究/$value;file.json"]);
  const script=Buffer.from(args.at(-1)!,'base64').toString('utf16le');
  expect(script).toContain("'C:/研究''s/Codex.ps1'");expect(script).toContain("'C:/研究/$value;file.json'");
  expect(args[3]).toBe('-EncodedCommand');
});
it('rejects arguments with command-breaking control characters',()=>{
  expect(()=>powershellInvocation('C:/Codex.ps1',['submit','a\nb'])).toThrow('INVALID_MINERU_ARGUMENT');
});
it('recognizes the documented failed-task exit code without accepting another task',()=>{
  const payload=JSON.stringify({id:'owned-task',status:'failed'});
  expect(isOwnedTaskFailure(payload,2,'owned-task')).toBe(true);
  expect(isOwnedTaskFailure(payload,2,'another-task')).toBe(false);
  expect(isOwnedTaskFailure(payload,1,'owned-task')).toBe(false);
  expect(isOwnedTaskFailure(payload,2,undefined)).toBe(false);
});
