import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, rename, rm } from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, realpathSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { basename, dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { projectPath } from './path-policy.ts';
import { openDatabase } from './database.ts';
import {acquireProjectLock} from './project-lock.ts';

export const stageNames = ['领域扫描与灵感发现','实践问题与研究问题','文献检索设计','文献筛选与分级阅读','文献综合与研究缺口','研究设计','数据收集与分析','论文写作','全文审查与正式输出'];
type Metadata = { schemaVersion: 1; projectId: string; workflowVersion: string; createdAt: string };
export type Source = { id: string; name: string; relpath: string; sha256: string; bytes: number };
type Artifact = { id: string; relpath: string; currentVersionId: string | null };
type Version = { id: string; artifactId: string; hash: string; baseVersionId: string | null; state: string; createdAt: string };
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const fileHash = (path: string) => existsSync(path) ? hash(readFileSync(path)) : null;
const active = new Set<string>();

export class ProjectService {
  readonly root: string;
  readonly metadata: Metadata;
  readonly db: Database.Database;
  private closed = false;
  private releaseLock:()=>void;

  private constructor(root: string, metadata: Metadata) {
    this.root = realpathSync(root);
    this.metadata = metadata;
    if (active.has(metadata.projectId)) throw new Error('PROJECT_ALREADY_OPEN');
    projectPath(this.root, '.cyz/state.sqlite', true);
    this.releaseLock=acquireProjectLock(this.root,metadata.projectId);
    try{this.db = openDatabase(join(this.root, '.cyz/state.sqlite'));}
    catch(error){this.releaseLock();throw error}
    try{this.recoverPublications();active.add(metadata.projectId);}
    catch(error){this.db.close();this.releaseLock();throw error}
  }

  static async create(root: string) {
    await mkdir(root, { recursive: true });
    const metaPath = projectPath(root, '.cyz/project.json', true);
    await mkdir(dirname(metaPath), { recursive: true });
    const metadata: Metadata = { schemaVersion: 1, projectId: randomUUID(), workflowVersion: '0.3.0', createdAt: new Date().toISOString() };
    await writeFile(metaPath, JSON.stringify(metadata, null, 2), { flag: 'wx' });
    return new ProjectService(root, metadata);
  }

  static async open(root: string) {
    const metaPath = projectPath(root, '.cyz/project.json', true);
    const metadata = JSON.parse(await readFile(metaPath, 'utf8')) as Metadata;
    if (metadata.schemaVersion !== 1) throw new Error('UNSUPPORTED_SCHEMA');
    if (!/^[0-9a-f-]{36}$/i.test(metadata.projectId) || metadata.workflowVersion !== '0.3.0') throw new Error('UNSUPPORTED_PROJECT');
    return new ProjectService(root, metadata);
  }

  snapshot() {
    return {
      project: { id: this.metadata.projectId, root: this.root, name: basename(this.root), workflowVersion: this.metadata.workflowVersion },
      stages: stageNames.map((name, index) => ({ id: 'S' + index, name, status: 'pending' })),
      sources: this.db.prepare('SELECT * FROM sources ORDER BY rowid').all() as Source[],
      artifacts: this.db.prepare('SELECT * FROM artifacts ORDER BY relpath').all() as Artifact[],
      tasks: this.db.prepare('SELECT * FROM tasks ORDER BY createdAt').all(),
      snapshotSeq: (this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get() as { seq: number }).seq,
    };
  }

  emit(type: string, payload: unknown) {
    this.db.prepare('INSERT INTO events(eventId,type,payload,occurredAt) VALUES(?,?,?,?)').run(randomUUID(), type, JSON.stringify(payload), new Date().toISOString());
  }

  eventsAfter(seq: number) {
    return (this.db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq').all(seq) as { seq: number; eventId: string; type: string; payload: string; occurredAt: string }[]).map(event => ({ ...event, payload: JSON.parse(event.payload) }));
  }

  async importSource(external: string, signal?: AbortSignal): Promise<Source & { reused: boolean }> {
    if (signal?.aborted) throw new Error('IMPORT_CANCELLED');
    const original = await stat(external);
    if (!original.isFile()) throw new Error('SOURCE_NOT_FILE');
    const id = randomUUID();
    const name = basename(external);
    const relpath = `02-文献/原件/${id}/${name}`;
    const destination = projectPath(this.root, relpath);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = destination + '.importing';
    const digest = createHash('sha256');
    try {
      await pipeline(createReadStream(external), new Transform({ transform(chunk, _encoding, callback) { digest.update(chunk); callback(null, chunk); } }), createWriteStream(temporary, { flags: 'wx' }), { signal });
      if (signal?.aborted) throw new Error('IMPORT_CANCELLED');
      const current = await stat(external);
      if (current.size !== original.size || current.mtimeMs !== original.mtimeMs) throw new Error('SOURCE_CHANGED');
      const sha256 = digest.digest('hex');
      const existing = this.db.prepare('SELECT * FROM sources WHERE sha256=?').get(sha256) as Source | undefined;
      if (existing) return { ...existing, reused: true };
      projectPath(this.root, relpath);
      await rename(temporary, destination);
      const source = { id, name, relpath, sha256, bytes: current.size };
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO sources(id,name,relpath,sha256,bytes) VALUES(@id,@name,@relpath,@sha256,@bytes)').run(source);
        this.emit('source.imported', source);
      })();
      return { ...source, reused: false };
    } finally { await rm(temporary, { force: true }); }
  }

  async saveArtifact(relpath: string, content: string, baseVersionId: string | null) {
    const destination = projectPath(this.root, relpath);
    const bytes = Buffer.from(content);
    if (bytes.length > 10 * 1024 * 1024) throw new Error('ARTIFACT_TOO_LARGE');
    const contentHash = hash(bytes);
    const objectPath = projectPath(this.root, `.cyz/versions/${contentHash}`, true);
    mkdirSync(dirname(objectPath), { recursive: true });
    if (!existsSync(objectPath)) writeFileSync(objectPath, bytes, { flag: 'wx' });
    let artifact = this.db.prepare('SELECT * FROM artifacts WHERE relpath=?').get(relpath) as Artifact | undefined;
    if (!artifact) {
      artifact = { id: randomUUID(), relpath, currentVersionId: null };
      this.db.prepare('INSERT INTO artifacts(id,relpath,currentVersionId) VALUES(@id,@relpath,@currentVersionId)').run(artifact);
    }
    const current = artifact.currentVersionId ? this.db.prepare('SELECT * FROM versions WHERE id=?').get(artifact.currentVersionId) as Version : undefined;
    const versionId = randomUUID();
    const conflict = baseVersionId !== artifact.currentVersionId || fileHash(destination) !== (current?.hash ?? null);
    this.db.prepare('INSERT INTO versions(id,artifactId,hash,baseVersionId,state,createdAt) VALUES(?,?,?,?,?,?)').run(versionId, artifact.id, contentHash, baseVersionId, conflict ? 'conflict' : 'candidate', new Date().toISOString());
    if (conflict) {
      this.emit('artifact.conflict', { artifactId: artifact.id, versionId });
      return { status: 'conflict', versionId };
    }
    const opId = randomUUID();
    this.db.prepare('INSERT INTO publish_ops(id,artifactId,versionId,oldHash,newHash,phase) VALUES(?,?,?,?,?,?)').run(opId, artifact.id, versionId, current?.hash ?? null, contentHash, 'prepared');
    mkdirSync(dirname(destination), { recursive: true });
    const temp = destination + '.' + opId + '.tmp';
    const fd = openSync(temp, 'wx');
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    projectPath(this.root, relpath);
    if (fileHash(destination) !== (current?.hash ?? null)) {
      this.db.prepare("UPDATE versions SET state='conflict' WHERE id=?").run(versionId);
      this.db.prepare("UPDATE publish_ops SET phase='conflict' WHERE id=?").run(opId);
      this.emit('artifact.conflict', { artifactId: artifact.id, versionId });
      return { status: 'conflict', versionId };
    }
    renameSync(temp, destination);
    this.db.prepare("UPDATE publish_ops SET phase='file_replaced' WHERE id=?").run(opId);
    this.commitPublication(opId, artifact.id, versionId);
    return { status: 'published', versionId };
  }

  private commitPublication(opId: string, artifactId: string, versionId: string) {
    this.db.transaction(() => {
      this.db.prepare('UPDATE artifacts SET currentVersionId=? WHERE id=?').run(versionId, artifactId);
      this.db.prepare("UPDATE versions SET state='published' WHERE id=?").run(versionId);
      this.db.prepare("UPDATE publish_ops SET phase='committed' WHERE id=?").run(opId);
      this.emit('artifact.published', { artifactId, versionId });
    })();
  }

  private recoverPublications() {
    const ops = this.db.prepare("SELECT publish_ops.*, artifacts.relpath FROM publish_ops JOIN artifacts ON artifacts.id=publish_ops.artifactId WHERE phase IN ('prepared','file_replaced')").all() as { id: string; artifactId: string; versionId: string; oldHash: string | null; newHash: string; relpath: string }[];
    for (const op of ops) {
      const actual = fileHash(projectPath(this.root, op.relpath));
      if (actual === op.newHash) this.commitPublication(op.id, op.artifactId, op.versionId);
      else {
        this.db.prepare("UPDATE publish_ops SET phase='conflict' WHERE id=?").run(op.id);
        this.db.prepare("UPDATE versions SET state='conflict' WHERE id=?").run(op.versionId);
        this.emit('recovery.required', { versionId: op.versionId, originalUnchanged: actual === op.oldHash });
      }
    }
  }

  history(relpath: string) {
    return this.db.prepare('SELECT versions.* FROM versions JOIN artifacts ON artifacts.id=versions.artifactId WHERE artifacts.relpath=? ORDER BY versions.rowid').all(relpath) as Version[];
  }

  readVersion(versionId: string) {
    const version = this.db.prepare('SELECT * FROM versions WHERE id=?').get(versionId) as Version | undefined;
    if (!version) throw new Error('VERSION_NOT_FOUND');
    const bytes = readFileSync(projectPath(this.root, `.cyz/versions/${version.hash}`, true));
    if (hash(bytes) !== version.hash) throw new Error('VERSION_INTEGRITY_ERROR');
    return bytes.toString('utf8');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try{this.db.close()}finally{this.releaseLock();active.delete(this.metadata.projectId)}
  }
}
