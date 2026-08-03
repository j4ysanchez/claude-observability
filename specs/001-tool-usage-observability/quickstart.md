# Quickstart: Validating Tool & Subagent Usage Observability

This is a validation guide, to be run once the tasks in `tasks.md` are implemented — it
proves the feature end-to-end against the contracts in `contracts/api.md` and the entities
in `data-model.md`. It does not duplicate implementation code.

## Prerequisites

- Node.js 20+
- Have used Claude Code locally at least once, so `~/.claude/projects/**/*.jsonl`
  contains real transcript data (or use the fixtures in `tests/fixtures/` for a
  controlled, deterministic run)

## Setup

```bash
npm install
npm run build   # or the project's equivalent compile step
npm start        # starts the localhost dashboard, e.g. http://127.0.0.1:4317
```

## Scenario 1 — No data yet (SC-006, Edge Cases)

1. Point the tool at an empty/nonexistent transcript root (e.g. a temp `HOME`).
2. Open the dashboard.
3. **Expect**: `GET /api/status` returns `hasTranscriptSource` reflecting reality and a
   human-readable `message` explaining why nothing is showing — the UI surfaces this
   message rather than an empty table. Determinable within 15 seconds of opening (SC-006).

## Scenario 2 — Basic tool breakdown (User Story 1, SC-001)

1. Run a handful of real (or fixture) Claude Code sessions that use a mix of tools
   (`Bash`, `Read`, `Edit`, `Grep`, ...).
2. Open the dashboard, select range "today".
3. **Expect**: `GET /api/summary?range=today` lists every tool type used with an
   accurate count; the top 5 by count are identifiable in the UI in under 30 seconds
   without opening any transcript.

## Scenario 3 — Why/how/validation drill-down (User Story 2, SC-007, SC-008)

1. From the breakdown, drill into one `Edit` invocation that was followed by a re-read
   of the same file, and one read-only `Read` invocation.
2. **Expect** (`GET /api/events/:eventId`): the `Edit` shows non-null `reasoning`,
   `inputSummary` containing the target file, and a `validation.result` of `confirmed`
   or `mismatch_corrected`; the `Read` shows `validation.result: not_applicable` (no
   natural expected output to check) — the two null-ish states are visibly distinguished
   in the UI (FR-016), not collapsed into a single "N/A".
3. Pick an invocation from a session where the agent stated no reasoning; **expect**
   `reasoning: null` rendered as "not captured," never fabricated.

## Scenario 4 — Subagent usage (User Story 3, SC-002)

1. Run a session that delegates to at least two different subagent types.
2. Open the subagent view for range "today".
3. **Expect**: `GET /api/summary?range=today` → `bySubagent` lists each subagent type
   with its count and outcome breakdown; drilling into one invocation
   (`GET /api/events/:eventId`) shows its task/prompt and final outcome.
4. Start a long-running/background subagent and query before it finishes.
   **Expect**: outcome `in_progress`, not merged into `succeeded`/`failed`.

## Scenario 5 — Trends over time (User Story 4, SC-005)

1. Use fixture data spanning at least 8 distinct days (to cross a week boundary).
2. Request `GET /api/trend?range=30d&granularity=day`.
3. **Expect**: one bucket per day including days with zero activity (present with empty
   counts, not omitted); a developer can tell this week's usage differs from last week's
   without writing a query.

## Scenario 6 — Session drill-down (User Story 5)

1. Pick one session with multiple invocations of different outcomes.
2. `GET /api/sessions/:sessionId/events`.
3. **Expect**: events returned in chronological (`sequence`) order, each showing type and
   outcome, each openable into its Scenario 3 detail view.

## Scenario 7 — Redaction (Edge Cases, FR-017)

1. Include a fixture transcript line whose `tool_use.input` contains a fake but
   pattern-matching secret (e.g. `AKIA...`-style key, `sk-...` token).
2. Ingest it and inspect the stored `usage_events.input_summary` directly in the SQLite
   file (not just the API response).
3. **Expect**: the secret pattern is replaced with `[REDACTED]` on disk — never present
   in the raw database file, not just hidden by the UI.

## Scenario 8 — Denied vs. failed (Edge Cases, FR-009)

1. Include one fixture invocation that was user-denied and one that genuinely errored
   (non-zero exit / tool error).
2. **Expect**: `outcome` is `denied` for the first, `failed` for the second — never both
   collapsed into one bucket in `GET /api/summary`.
