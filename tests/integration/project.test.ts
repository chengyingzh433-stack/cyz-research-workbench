import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, readdir, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectService } from '../../packages/project-service/src/project.ts';

const opened: ProjectService[] = [];
afterEach(() => { for (const service of opened.splice(0)) service.close(); });
async function create() {
  const root = await mkdtemp(join(tmpdir(), 'cyz 中文 项目 '));
  const service = await ProjectService.create(root);
  opened.push(service);
  return { root, service };
}

describe('local projects and sources', () => {
  it('keeps identity when reopened and moved with no model work', async () => {
    const { root, service } = await create();
    const id = service.snapshot().project.id;
    service.close();
    const moved = await mkdtemp(join(tmpdir(), 'cyz 移动 '));
    await cp(root, moved, { recursive: true });
    const reopened = await ProjectService.open(moved);
    opened.push(reopened);
    expect(reopened.snapshot().project.id).toBe(id);
    expect(reopened.snapshot().tasks).toEqual([]);
    expect(reopened.snapshot().stages).toHaveLength(9);
  });

  it('rejects an unknown project schema without rewriting metadata', async () => {
    const { root, service } = await create();
    service.close();
    const path = join(root, '.cyz', 'project.json');
    const metadata = JSON.parse(await readFile(path, 'utf8'));
    const future = JSON.stringify({ ...metadata, schemaVersion: 99 });
    await writeFile(path, future);
    await expect(ProjectService.open(root)).rejects.toThrow('UNSUPPORTED_SCHEMA');
    expect(await readFile(path, 'utf8')).toBe(future);
  });

  it('disallows two writing instances of the same project', async () => {
    const { root } = await create();
    await expect(ProjectService.open(root)).rejects.toThrow('PROJECT_ALREADY_OPEN');
  });

  it('preserves external source and deduplicates identical bytes', async () => {
    const { service } = await create();
    const external = await mkdtemp(join(tmpdir(), 'cyz source '));
    const path = join(external, '论文.md');
    await writeFile(path, '外部材料不可改动');
    const one = await service.importSource(path);
    const two = await service.importSource(path);
    expect(two.id).toBe(one.id);
    expect(two.reused).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('外部材料不可改动');
    expect(service.snapshot().sources).toHaveLength(1);
    expect(service.eventsAfter(0).filter(e => e.type === 'source.imported')).toHaveLength(1);
  });

  it('retains same-name different-content sources separately', async () => {
    const { root, service } = await create();
    const external = await mkdtemp(join(tmpdir(), 'cyz source '));
    const path = join(external, 'same.md');
    await writeFile(path, 'first');
    const first = await service.importSource(path);
    await writeFile(path, 'second');
    const second = await service.importSource(path);
    expect(first.id).not.toBe(second.id);
    expect(await readFile(join(root, first.relpath), 'utf8')).toBe('first');
    expect(await readFile(join(root, second.relpath), 'utf8')).toBe('second');
  });

  it('does not register a cancelled import', async () => {
    const { service } = await create();
    const abort = new AbortController(); abort.abort();
    await expect(service.importSource('not-accessed.pdf', abort.signal)).rejects.toThrow('IMPORT_CANCELLED');
    expect(service.snapshot().sources).toEqual([]);
  });

  it.each(['../outside.md', 'C:/outside.md', 'a:stream', 'CON.txt', '/absolute', 'a/../b', 'a\\b', 'trailing.', '.cyz/state.sqlite'])('rejects unsafe artifact path %s', async path => {
    const { service } = await create();
    await expect(service.saveArtifact(path, 'unsafe', null)).rejects.toThrow('INVALID_PATH');
  });

  it('retains both versions on stale-base conflict and rolls back as a new version', async () => {
    const { root, service } = await create();
    const first = await service.saveArtifact('07-写作/草稿.md', 'first', null);
    const human = await service.saveArtifact('07-写作/草稿.md', 'human', first.versionId);
    const conflict = await service.saveArtifact('07-写作/草稿.md', 'AI stale', first.versionId);
    expect(conflict.status).toBe('conflict');
    expect(await readFile(join(root, '07-写作/草稿.md'), 'utf8')).toBe('human');
    expect(service.readVersion(conflict.versionId)).toBe('AI stale');
    const rollback = await service.saveArtifact('07-写作/草稿.md', service.readVersion(first.versionId), human.versionId);
    expect(rollback.versionId).not.toBe(first.versionId);
    expect(service.history('07-写作/草稿.md')).toHaveLength(4);
  });

  it('detects external file edits before publishing and preserves the candidate', async () => {
    const { root, service } = await create();
    const first = await service.saveArtifact('draft.md', 'baseline', null);
    await writeFile(join(root, 'draft.md'), 'external human edit');
    const result = await service.saveArtifact('draft.md', 'candidate', first.versionId);
    expect(result.status).toBe('conflict');
    expect(await readFile(join(root, 'draft.md'), 'utf8')).toBe('external human edit');
    expect(service.readVersion(result.versionId)).toBe('candidate');
  });

  it('recovers a replaced file whose database commit was interrupted exactly once',async()=>{
    const {root,service}=await create();
    const first=await service.saveArtifact('draft.md','first',null);
    const second=await service.saveArtifact('draft.md','second',first.versionId);
    service.db.prepare('UPDATE artifacts SET currentVersionId=?').run(first.versionId);
    service.db.prepare("UPDATE versions SET state='candidate' WHERE id=?").run(second.versionId);
    service.db.prepare("UPDATE publish_ops SET phase='prepared' WHERE versionId=?").run(second.versionId);
    service.close();
    const recovered=await ProjectService.open(root);opened.push(recovered);
    expect(recovered.snapshot().artifacts[0].currentVersionId).toBe(second.versionId);
    expect(await readFile(join(root,'draft.md'),'utf8')).toBe('second');
    const seq=recovered.snapshot().snapshotSeq;recovered.close();
    const again=await ProjectService.open(root);opened.push(again);
    expect(again.snapshot().snapshotSeq).toBe(seq);
  });

  it('does not overwrite an external edit while recovering an interrupted publication',async()=>{
    const {root,service}=await create();
    const first=await service.saveArtifact('draft.md','first',null);
    const second=await service.saveArtifact('draft.md','candidate',first.versionId);
    service.db.prepare('UPDATE artifacts SET currentVersionId=?').run(first.versionId);
    service.db.prepare("UPDATE publish_ops SET phase='file_replaced' WHERE versionId=?").run(second.versionId);
    await writeFile(join(root,'draft.md'),'human edit after crash');service.close();
    const recovered=await ProjectService.open(root);opened.push(recovered);
    expect(await readFile(join(root,'draft.md'),'utf8')).toBe('human edit after crash');
    expect(recovered.history('draft.md').find(v=>v.id===second.versionId)?.state).toBe('conflict');
    expect(recovered.readVersion(second.versionId)).toBe('candidate');
  });
});
