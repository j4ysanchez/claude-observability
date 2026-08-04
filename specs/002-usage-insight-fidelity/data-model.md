# Phase 1 Data Model: Usage Insight Fidelity

This is a refinement of `001-tool-usage-observability`'s data model
(`specs/001-tool-usage-observability/data-model.md`), not a new one. Only the deltas are
shown here; any field not mentioned is unchanged from `001`. As in `001`, every free-text
field has already passed through `redact()` by the time it exists in these shapes.

## Usage Event *(refined)*

Adds one field: `summary`.

| Field | Type | Notes |
|---|---|---|
| `summary` | string | **NEW.** Plain-language description of what the invocation did (FR-001–003, research.md §4). Always non-null/non-empty — every invocation gets some readable description, never omitted. Built by `core/summarize-invocation.ts`; redacted like every other free-text field. Distinct from `inputSummary` (unchanged: the raw, redacted, serialized `input` object) — `summary` is what list/detail views show as "what happened"; `inputSummary` remains the full raw detail available on drill-down (FR-003). |
| `reasoning` | string \| null | **Unchanged shape**, corrected extraction (research.md §1): now derived by walking backward across consecutive prior transcript *lines* linked by `parentUuid`, not blocks within one line. `null` still means "genuinely not captured," never inferred. |
| `subagentType` / `subagentTask` | string \| null | **Unchanged shape**, corrected detection (research.md §3): `isSubagent` (and therefore these fields being populated) is now true for `toolName` in a known-delegation-name set (`{"Task", "Agent"}`), not one hardcoded literal. |

**Validation rules**: Same as `001`, plus: `summary` is never `null`/empty for any event
produced by the corrected pipeline (contrast with `reasoning`, which legitimately can be
`null`).

SQLite (delta only — full statement in `storage/schema.ts`):
```sql
ALTER TABLE usage_events ADD COLUMN summary TEXT NOT NULL DEFAULT '';
```
(Expressed as an `ALTER TABLE` here for clarity; in practice the backfill (§ below)
wipes and recreates `usage_events` from the updated `CREATE TABLE` statement in
`schema.ts`, so a real migration path is unnecessary — see research.md §5.)

## Validation Check *(unchanged shape, corrected detection)*

No field changes. `result` values and meaning are identical to `001`. Only the detection
heuristic behind `detectValidation` changes (research.md §2): it now runs against real
(non-null) reasoning text, and `VERIFY_KEYWORDS` covers a broader set of implicit
verification phrasing.

## Usage Summary (derived, not persisted) *(refined)*

`bySubagent` (and `trend()`'s `subagentCounts`) now include an explicit entry for
delegations whose type could not be determined, instead of silently omitting them
(FR-009, research.md §3):

```ts
type SubagentCount = {
  subagentType: string;   // a real subagent type value, OR the reserved sentinel below
  count: number;
  outcomes: Record<Outcome, number>;
};

const UNKNOWN_SUBAGENT_TYPE = "unknown_type"; // reserved sentinel, never a real type value
```

**Validation rules**: `subagentType === "unknown_type"` iff the source event's
`subagentType` was `null`/empty at ingest time (missing/empty/null on the `Task`/`Agent`
tool_use's own `input.subagent_type`, per this feature's clarification — an unfamiliar but
non-empty custom subagent name is its own distinct entry, never folded into
`"unknown_type"`). `byTool` is unaffected (it already groups by `toolName`, which is
always present).

## Schema Meta *(new, implementation-internal — not a spec entity)*

Gates the one-time historical backfill (FR-010, research.md §5). Not user-visible.

| Field | Type | Notes |
|---|---|---|
| `id` | integer (PK, always `1`) | Single-row table |
| `logic_version` | integer | Bumped in source whenever ingest/extraction logic changes in a way that requires re-deriving historical data |

```sql
CREATE TABLE schema_meta (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  logic_version  INTEGER NOT NULL
);
```

**Backfill rule**: On `serve`/`sync` startup, if `schema_meta` is empty or its
`logic_version` doesn't match the build's current constant, wipe `sessions`,
`usage_events`, `validation_checks`, and `ingest_cursors`, re-run `syncTranscripts(db)`
against every discovered transcript from byte 0, then upsert `schema_meta` with the
current version. Otherwise, no-op. This is the entire mechanism behind FR-010/SC-006 —
there is no per-row "needs re-evaluation" flag; the backfill is all-or-nothing and
idempotent by construction (re-running `syncTranscripts` against the same transcripts
from scratch always reproduces the same rows under the current logic).

## Entity relationships

Unchanged from `001`:

```
Session (1) ──< (many) UsageEvent ──< (0 or 1) ValidationCheck
                    │
                    └─ isSubagent=true rows (toolName ∈ {"Task","Agent"}) ARE the
                       "Subagent Invocation" view — same table, no separate entity/table.
                       subagentType = "unknown_type" is a value, not a different kind of row.

SchemaMeta — implementation-internal, no FK relationship to any spec entity; gates
                       whether the four tables above get wiped and rebuilt at startup.
```
