import Database from 'better-sqlite3';

export function openDatabase(path: string) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, eventId TEXT UNIQUE NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, occurredAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, relpath TEXT NOT NULL, sha256 TEXT UNIQUE NOT NULL, bytes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, relpath TEXT UNIQUE NOT NULL, currentVersionId TEXT);
    CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, artifactId TEXT NOT NULL REFERENCES artifacts(id), hash TEXT NOT NULL, baseVersionId TEXT, state TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS publish_ops (id TEXT PRIMARY KEY, artifactId TEXT NOT NULL REFERENCES artifacts(id), versionId TEXT NOT NULL REFERENCES versions(id), oldHash TEXT, newHash TEXT NOT NULL, phase TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, stageId TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL, threadId TEXT, turnId TEXT, runId TEXT NOT NULL, createdAt TEXT NOT NULL);
  `);
  return db;
}
