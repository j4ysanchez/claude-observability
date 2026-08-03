# Phase 1 Data Model: Claude Code Tool & Subagent Usage Observability

Entities below map 1:1 onto the spec's Key Entities. Each is modeled first as an
immutable TypeScript shape produced by the pure core (`src/core/`), then as the SQLite
table the storage boundary (`src/storage/`) persists it into. All string fields that may
contain agent-authored free text have already passed through `redact()` (research.md §7)
by the time they exist as these shapes — there is no "raw" variant that reaches storage.

## Session

Groups an ordered sequence of Usage Events from one Claude Code transcript file.

| Field | Type | Notes |
|---|---|---|
| `sessionId` | string (PK) | Claude Code's own session id (transcript filename stem) |
| `projectPath` | string | `cwd` from the transcript — retained as context only, never a filter (FR-018) |
| `gitBranch` | string \| null | From transcript, if present |
| `startedAt` | ISO 8601 string | Timestamp of the first ingested line |
| `lastEventAt` | ISO 8601 string | Timestamp of the most recently ingested line; updated on each incremental ingest |
| `transcriptPath` | string | Absolute path to the source `.jsonl`, for traceability/debugging only |

Derived (not stored, computed at query time): `status: 'in_progress' | 'concluded'` —
`in_progress` iff `now - lastEventAt < 5 minutes` (research.md §8).

**Validation rules**: `sessionId` and `transcriptPath` required and immutable once
created. `lastEventAt >= startedAt` always (enforced by construction: ingest only ever
appends lines in file order).

SQLite:
```sql
CREATE TABLE sessions (
  session_id      TEXT PRIMARY KEY,
  project_path    TEXT NOT NULL,
  git_branch      TEXT,
  started_at      TEXT NOT NULL,
  last_event_at   TEXT NOT NULL,
  transcript_path TEXT NOT NULL
);
```

## Usage Event

A single tool invocation. `SubagentInvocation` (below) is a `UsageEvent` with
`toolName = 'Task'` plus two extra fields — same table, not a separate hierarchy
(Principle III: composition, not a type hierarchy).

| Field | Type | Notes |
|---|---|---|
| `eventId` | string (PK) | `${sessionId}:${uuid}` — stable, idempotent across re-ingest |
| `sessionId` | string (FK → Session) | |
| `sequence` | integer | Ordinal position within the session (ingest order = transcript line order) |
| `timestamp` | ISO 8601 string | From the transcript line |
| `toolName` | string | e.g. `Bash`, `Read`, `Edit`, `Task` |
| `isSubagent` | boolean | `true` iff `toolName === 'Task'` |
| `subagentType` | string \| null | Populated only when `isSubagent` |
| `subagentTask` | string \| null | Redacted `description`/`prompt`; populated only when `isSubagent` (FR-003) |
| `outcome` | `'succeeded' \| 'failed' \| 'denied' \| 'in_progress'` | Per research.md §2 (FR-009) |
| `reasoning` | string \| null | Redacted "why" (FR-012); `null` = not captured, never inferred |
| `inputSummary` | string \| null | Redacted, serialized `tool_use.input` (FR-013) |
| `projectPath` | string | Denormalized from `Session` for query convenience (FR-001 context, FR-018 non-filterable) |

**Validation rules**: `subagentType`/`subagentTask` are non-null iff `isSubagent` is true
(enforced by the pure `build-usage-event.ts` constructor — there is no code path that
produces an inconsistent combination). `outcome` is always one of the four literal
values; there is no "unknown" — a `Task`/tool with no `tool_result` yet is `in_progress`,
never null.

SQLite:
```sql
CREATE TABLE usage_events (
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
CREATE INDEX idx_usage_events_tool      ON usage_events(tool_name, timestamp);
CREATE INDEX idx_usage_events_subagent  ON usage_events(subagent_type, timestamp) WHERE is_subagent = 1;
CREATE INDEX idx_usage_events_session   ON usage_events(session_id, sequence);
CREATE INDEX idx_usage_events_time      ON usage_events(timestamp);
```

## Validation Check

An agent-performed follow-up action confirming or contradicting a Usage Event's expected
result. Zero or one per `UsageEvent` (the heuristic in research.md §6 detects at most one
follow-up check per event for v1).

| Field | Type | Notes |
|---|---|---|
| `id` | integer (PK, autoincrement) | |
| `usageEventId` | string (FK → UsageEvent) | |
| `checkedWhat` | string | Redacted description of the follow-up action observed |
| `result` | `'confirmed' \| 'mismatch_corrected' \| 'not_observed' \| 'not_applicable'` | Per research.md §6 (FR-014, FR-016) |

SQLite:
```sql
CREATE TABLE validation_checks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  usage_event_id  TEXT NOT NULL REFERENCES usage_events(event_id),
  checked_what    TEXT NOT NULL,
  result          TEXT NOT NULL CHECK (result IN ('confirmed','mismatch_corrected','not_observed','not_applicable'))
);
CREATE UNIQUE INDEX idx_validation_event ON validation_checks(usage_event_id);
```

## Usage Summary (derived, not persisted)

Not a table — a read-model shape produced by `core/summarize.ts` from SQL aggregate
query results (`GROUP BY tool_name` / `subagent_type` / date-bucketed `timestamp`, scoped
by the requested time range). Powers FR-005/FR-006/FR-007.

```ts
type UsageSummary = {
  range: 'today' | '7d' | '30d' | 'all';
  generatedAt: string;
  byTool: ReadonlyArray<{ toolName: string; count: number }>;
  bySubagent: ReadonlyArray<{ subagentType: string; count: number; outcomes: Record<Outcome, number> }>;
  trend: ReadonlyArray<{ bucket: string; toolCounts: Record<string, number>; subagentCounts: Record<string, number> }>;
};
```

**Validation rules**: `byTool`/`bySubagent` are always present, empty arrays (not
omitted/null) when no data exists for the range — this is what powers FR-010's "clearly
indicate no data" requirement at the shape level, distinct from an error response.

## Ingest Cursor (implementation-internal, not a spec entity)

Tracks incremental tailing progress per transcript file (research.md §9). Not
user-visible; exists purely so ingestion is idempotent and doesn't re-read whole files.

```sql
CREATE TABLE ingest_cursors (
  transcript_path   TEXT PRIMARY KEY,
  byte_offset       INTEGER NOT NULL,
  last_ingested_at  TEXT NOT NULL
);
```

## Entity relationships

```
Session (1) ──< (many) UsageEvent ──< (0 or 1) ValidationCheck
                    │
                    └─ isSubagent=true rows ARE the "Subagent Invocation" view
                       (same table, no separate entity/table)
```
