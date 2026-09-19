import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectService} from '../../packages/project-service/src/project.ts';
import {readDocument,saveDocument} from '../../packages/project-service/src/documents.ts';
const services:ProjectService[]=[];
afterEach(()=>{for(const service of services.splice(0))service.close()});
async function create(){const service=await ProjectService.create(await mkdtemp(join(tmpdir(),'cyz 文档 ')));services.push(service);return service}
it('tracks the unchanged original as history before the first edit',async()=>{
  const service=await create();await writeFile(join(service.root,'matrix.md'),'已有说明');
  const document=readDocument(service,'matrix.md');expect(document.text).toBe('已有说明');expect(service.history('matrix.md')).toHaveLength(0);
  const result=await saveDocument(service,'matrix.md','新说明',document.versionId,document.hash);expect(result.status).toBe('published');
  expect(service.history('matrix.md')).toHaveLength(2);expect(service.readVersion(service.history('matrix.md')[0].id)).toBe('已有说明');
});
it('preserves an external edit made after opening an unmanaged file',async()=>{
  const service=await create();await writeFile(join(service.root,'matrix.md'),'before');const opened=readDocument(service,'matrix.md');
  await writeFile(join(service.root,'matrix.md'),'external');
  const result=await saveDocument(service,'matrix.md','candidate',opened.versionId,opened.hash);
  expect(result.status).toBe('conflict');expect(await readFile(join(service.root,'matrix.md'),'utf8')).toBe('external');expect(service.readVersion(result.versionId)).toBe('candidate');
});
it('checks the exact opened file hash even if an external edit is later reverted',async()=>{
  const service=await create();await service.saveArtifact('matrix.md','baseline',null);
  await writeFile(join(service.root,'matrix.md'),'external before opening');const opened=readDocument(service,'matrix.md');
  await writeFile(join(service.root,'matrix.md'),'baseline');
  const result=await saveDocument(service,'matrix.md','candidate',opened.versionId,opened.hash);
  expect(result.status).toBe('conflict');expect(await readFile(join(service.root,'matrix.md'),'utf8')).toBe('baseline');
});
it('preserves a UTF-8 byte-order mark in the original version',async()=>{
  const service=await create();await writeFile(join(service.root,'matrix.md'),'\uFEFF原文');
  const opened=readDocument(service,'matrix.md');expect(opened.text).toBe('\uFEFF原文');
  expect((await saveDocument(service,'matrix.md','新文',opened.versionId,opened.hash)).status).toBe('published');
  expect(service.readVersion(service.history('matrix.md')[0].id)).toBe('\uFEFF原文');
});
