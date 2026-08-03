import type Database from "better-sqlite3";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT PRIMARY KEY,
  project_path    TEXT NOT NULL,
  git_branch      TEXT,
  started_at      TEXT NOT NULL,
  last_event_at   TEXT NOT NULL,
  transcript_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  event_id       TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(session_id),
  sequence       INTEGER NOT NULL,
  timestamp      TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  is_subagent    INTEGER NOT NULL CHECK (is_subagent IN (0,1)),
  subagent_type  TEXT,
  subagent_task  TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('succeeded','failed','denied','in_progress')),
  reasoning      TEXT,
  input_summary  TEXT,
  project_path   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tool      ON usage_events(tool_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_events_subagent  ON usage_events(subagent_type, timestamp) WHERE is_subagent = 1;
CREATE INDEX IF NOT EXISTS idx_usage_events_session   ON usage_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_usage_events_time      ON usage_events(timestamp);

CREATE TABLE IF NOT EXISTS validation_checks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  usage_event_id  TEXT NOT NULL REFERENCES usage_events(event_id),
  checked_what    TEXT NOT NULL,
  result          TEXT NOT NULL CHECK (result IN ('confirmed','mismatch_corrected','not_observed','not_applicable'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_validation_event ON validation_checks(usage_event_id);

CREATE TABLE IF NOT EXISTS ingest_cursors (
  transcript_path   TEXT PRIMARY KEY,
  byte_offset       INTEGER NOT NULL,
  last_ingested_at  TEXT NOT NULL
);
`;

export function applySchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}
