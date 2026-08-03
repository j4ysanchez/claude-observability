import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Outcome, Session, UsageEvent } from "../core/types.js";
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

interface UsageEventRow {
  readonly event_id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly tool_name: string;
  readonly is_subagent: number;
  readonly subagent_type: string | null;
  readonly subagent_task: string | null;
  readonly outcome: Outcome;
  readonly reasoning: string | null;
  readonly input_summary: string | null;
  readonly project_path: string;
}

function rowToUsageEvent(row: UsageEventRow): UsageEvent {
  return {
    eventId: row.event_id,
    sessionId: row.session_id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    toolName: row.tool_name,
    isSubagent: row.is_subagent === 1,
    subagentType: row.subagent_type,
    subagentTask: row.subagent_task,
    outcome: row.outcome,
    reasoning: row.reasoning,
    inputSummary: row.input_summary,
    projectPath: row.project_path,
  };
}

/**
 * Inserts a UsageEvent, or updates the mutable fields of an existing row
 * with the same `eventId` (idempotent re-ingest, e.g. an in_progress
 * invocation later observed with a resolved outcome). `eventId` is stable
 * across re-ingest (`${sessionId}:${toolUseId}`, data-model.md), so this is
 * safe to call repeatedly for the same event.
 */
export function upsertUsageEvent(db: Database.Database, event: UsageEvent): void {
  db.prepare(
    `INSERT INTO usage_events
       (event_id, session_id, sequence, timestamp, tool_name, is_subagent,
        subagent_type, subagent_task, outcome, reasoning, input_summary, project_path)
     VALUES
       (@eventId, @sessionId, @sequence, @timestamp, @toolName, @isSubagent,
        @subagentType, @subagentTask, @outcome, @reasoning, @inputSummary, @projectPath)
     ON CONFLICT(event_id) DO UPDATE SET
       outcome = excluded.outcome,
       reasoning = excluded.reasoning,
       input_summary = excluded.input_summary,
       subagent_type = excluded.subagent_type,
       subagent_task = excluded.subagent_task`
  ).run({
    ...event,
    isSubagent: event.isSubagent ? 1 : 0,
  });
}

/**
 * The highest `sequence` already stored for a session, or 0 if none — lets
 * sync.ts continue numbering across multiple incremental syncs of the same
 * session (research.md §9).
 */
export function getMaxSequence(db: Database.Database, sessionId: string): number {
  const row = db
    .prepare(`SELECT MAX(sequence) AS maxSequence FROM usage_events WHERE session_id = ?`)
    .get(sessionId) as { maxSequence: number | null };
  return row.maxSequence ?? 0;
}

/**
 * All UsageEvents with `timestamp >= sinceIso`, or every event when
 * `sinceIso` is `null` (the `all` range) — scoped read for
 * `summarize.byTool` (and future `bySubagent`/trend aggregations).
 */
export function getUsageEventsSince(
  db: Database.Database,
  sinceIso: string | null
): UsageEvent[] {
  const rows = (
    sinceIso === null
      ? db.prepare(`SELECT * FROM usage_events ORDER BY session_id, sequence`).all()
      : db
          .prepare(`SELECT * FROM usage_events WHERE timestamp >= ? ORDER BY session_id, sequence`)
          .all(sinceIso)
  ) as UsageEventRow[];
  return rows.map(rowToUsageEvent);
}

export function countSessions(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM sessions`).get() as { count: number };
  return row.count;
}

/** Most recent `ingest_cursors.last_ingested_at` across all transcripts, or `null` if none have synced yet. */
export function getLastIngestAt(db: Database.Database): string | null {
  const row = db
    .prepare(`SELECT MAX(last_ingested_at) AS lastIngestAt FROM ingest_cursors`)
    .get() as { lastIngestAt: string | null };
  return row.lastIngestAt;
}
