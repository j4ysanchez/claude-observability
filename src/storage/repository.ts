import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Session } from "../core/types.js";
import { applySchema } from "./schema.js";

export function defaultDbPath(): string {
  return join(homedir(), ".claude-observability", "usage.db");
}

export function openDatabase(dbPath: string = defaultDbPath()): Database.Database {
  const dir = dirname(dbPath);
  if (dir !== ":memory:" && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  applySchema(db);
  return db;
}

interface SessionRow {
  readonly session_id: string;
  readonly project_path: string;
  readonly git_branch: string | null;
  readonly started_at: string;
  readonly last_event_at: string;
  readonly transcript_path: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    sessionId: row.session_id,
    projectPath: row.project_path,
    gitBranch: row.git_branch,
    startedAt: row.started_at,
    lastEventAt: row.last_event_at,
    transcriptPath: row.transcript_path,
  };
}

export function upsertSession(db: Database.Database, session: Session): void {
  db.prepare(
    `INSERT INTO sessions (session_id, project_path, git_branch, started_at, last_event_at, transcript_path)
     VALUES (@sessionId, @projectPath, @gitBranch, @startedAt, @lastEventAt, @transcriptPath)
     ON CONFLICT(session_id) DO UPDATE SET
       last_event_at = excluded.last_event_at,
       git_branch = excluded.git_branch`
  ).run({ ...session, gitBranch: session.gitBranch ?? null });
}

export function getSession(db: Database.Database, sessionId: string): Session | null {
  const row = db.prepare(`SELECT * FROM sessions WHERE session_id = ?`).get(sessionId) as
    | SessionRow
    | undefined;
  return row ? rowToSession(row) : null;
}

export function getCursor(db: Database.Database, transcriptPath: string): number {
  const row = db
    .prepare(`SELECT byte_offset FROM ingest_cursors WHERE transcript_path = ?`)
    .get(transcriptPath) as { byte_offset: number } | undefined;
  return row ? row.byte_offset : 0;
}

export function setCursor(
  db: Database.Database,
  transcriptPath: string,
  byteOffset: number,
  ingestedAt: string
): void {
  db.prepare(
    `INSERT INTO ingest_cursors (transcript_path, byte_offset, last_ingested_at)
     VALUES (?, ?, ?)
     ON CONFLICT(transcript_path) DO UPDATE SET
       byte_offset = excluded.byte_offset,
       last_ingested_at = excluded.last_ingested_at`
  ).run(transcriptPath, byteOffset, ingestedAt);
}
