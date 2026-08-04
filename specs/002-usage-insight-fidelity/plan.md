# Implementation Plan: Usage Insight Fidelity

**Branch**: `002-usage-insight-fidelity` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-usage-insight-fidelity/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

This is a fidelity fix, not a new feature: `001-tool-usage-observability`'s pure core
mis-models the actual shape of Claude Code's `.jsonl` transcripts, so three of its
outputs are close to useless in practice. Direct inspection of real local transcripts and
the already-populated local database (`~/.claude-observability/usage.db`, 6,991 events)
confirms the root causes and their real-world severity:

1. **Summary is raw JSON, not language** (FR-001–003): the most recent commit added
   `inputPreview` = `redact(JSON.stringify(input))` sliced to 80 characters — literally
   the escaped, truncated wall of text the user is complaining about, now also cut off
   mid-command. Fix: a new `summary` field built by a pure per-tool renderer, preferring
   the tool's own `input.description` (already present, agent-authored, on ~35% of real
   `Bash` calls sampled) and falling back to small tool-specific phrasing — never raw
   JSON, never truncated by the API.
2. **Reasoning is captured 0% of the time** (FR-004–005): `extractReasoning` only looks
   at content blocks *preceding a tool_use within the same transcript line's
   `message.content[]` array*. Real transcripts never populate that array with more than
   one block — `thinking`, `text`, and `tool_use` each arrive as their own consecutive
   JSONL line, linked by `uuid`/`parentUuid` (confirmed against 673 real assistant
   lines: 100% single-block). So the "preceding blocks" list is always empty and
   reasoning is always `null` — confirmed by the local DB (0 of 6,991 events have
   non-null `reasoning`). Fix: walk backward across consecutive prior *lines* linked by
   `parentUuid`, not blocks within one line.
3. **Validation is essentially never detected** (FR-006–007): `detectValidation` gates
   every match on `extractReasoning(...)` being non-null (to test verification
   keywords). Since reasoning is always null (root cause #2), validation can
   mathematically never reach `confirmed`/`mismatch_corrected` — the local DB confirms
   0/6,991 in either state, only `not_observed`/`not_applicable`. This is a downstream
   symptom of #2, not an independent bug; fixing #2 is a prerequisite, and the keyword
   heuristic itself also needs broadening now that it will actually run.
4. **Subagent delegations are invisible** (FR-008–009): `isSubagent`/subagent-field
   extraction hardcodes `toolName === "Task"`. Real local transcripts show delegation
   tool calls under **two different names** depending on Claude Code build —
   `"Task"` (14 occurrences in one sampled project) and `"Agent"` (62 occurrences, same
   project, identical `input.subagent_type`/`description`/`prompt` shape) — only the
   `"Task"`-named ones are currently flagged `is_subagent = 1`. Separately,
   `summarize.ts`'s `bySubagent` silently drops any event whose `subagentType` is
   `null` instead of grouping it under "unknown type" per FR-009. Fix: match delegation
   by a small known-name set instead of one literal, and group null/empty types instead
   of dropping them.
5. **Historical sessions never get corrected** (FR-010): `syncTranscripts` only tails
   bytes *past* each transcript's stored cursor — it has no path back to already-ingested
   rows. Fix: a one-time, blocking backfill (full wipe + re-sync of the derived tables,
   gated by a stored `logic_version` marker) that runs at server startup, before the HTTP
   listener starts accepting connections — matching the spec clarification that
   re-evaluation must complete before any view can be opened.

No new external dependencies and no architectural change: this stays inside the existing
pure-core (`src/core/`) / imperative-shell (`src/ingest/`, `src/storage/`, `src/server/`)
split from `001`. All five fixes are either corrections to existing pure functions or a
small addition to the storage/CLI boundary (the backfill gate).

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+ (unchanged from `001`)

**Primary Dependencies**: None added. Continues to use `better-sqlite3`, Node built-ins
(`node:http`, `node:util.parseArgs`), and the dependency-free static frontend already in
place.

**Storage**: Same SQLite file (`~/.claude-observability/usage.db`). Schema changes: add
`summary TEXT NOT NULL` to `usage_events`, and a new single-row `schema_meta` table
holding a `logic_version` marker that gates the one-time backfill.

**Testing**: Vitest, unchanged approach — unit tests against the pure core using real
fixture `.jsonl` excerpts (now including multi-line thinking/text/tool_use sequences
reflecting the corrected transcript model, an `"Agent"`-named delegation, and a
`description`-carrying `Bash` call), integration tests against the boundary modules
(including a new test that a wiped/legacy-version DB gets backfilled before `serve`
starts accepting requests).

**Target Platform**: Local developer machine (macOS/Linux/Windows), unchanged.

**Project Type**: Single project (unchanged — see Structure Decision below).

**Performance Goals**: Unchanged targets (<200ms aggregate queries, sub-second incremental
sync) for steady-state operation; the one-time backfill is explicitly allowed to take
longer (it is a one-time, blocking startup cost bounded by the size of on-disk transcript
history, not a per-request path) but must still complete before the dashboard opens
(FR-010, SC-006).

**Constraints**: Same as `001` (offline except `localhost` binding, redact-before-persist).
Additionally: the backfill MUST be idempotent and safe to run on every `serve` startup
(it is a no-op once `logic_version` already matches), since there is no separate
"migration" step in this tool's deployment model — restarting the process *is* the
deployment.

**Scale/Scope**: Same as `001`. The local DB already observed in this environment
(6,991 events across ~11 sessions in one project alone) is a realistic lower bound for
what a backfill must handle promptly on startup.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Simplicity First | No new framework or dependency. The backfill is "wipe derived tables + re-run the existing idempotent sync," not a bespoke migration/patching system — the transcripts remain the source of truth, so rebuilding is strictly simpler than incrementally repairing rows in place. | PASS |
| II. Immutable Data, Pure Functions | All five fixes except the backfill gate live entirely in `src/core/` as pure functions over immutable inputs (corrected `extractReasoning`, new `summarizeInvocation`, corrected subagent-name matching, corrected `bySubagent` grouping). The backfill itself is boundary-only (`storage/`, `cli/`), no pure-core changes. | PASS |
| III. Composability Over Inheritance | The new `summary` computation is one more small pure function composed into the existing `build-usage-event.ts` pipeline (parse → classify → extract-context → summarize-invocation → redact), not a new class or subtype. `"unknown type"` subagent grouping is a data value (a sentinel string), not a new entity/type. | PASS |
| IV. Decoupling Through Explicit Boundaries | The corrected reasoning walk needs access to the full ordered `lines` array (not just one line's blocks) — this stays an explicit function parameter (`extractReasoning(lines, lineIndex)`), not shared/module-level state. The backfill communicates with `cli/main.ts` and `server/http-server.ts` only through an explicit `runBackfillIfNeeded(db)` function call. | PASS |
| V. Secure by Default | Redaction continues to run inside the pure core before any new field (`summary`) reaches storage — same `redact()` call, applied to the new field exactly as it already is to `reasoning`/`inputSummary`/`subagentTask` (FR-011). The backfill wipes and rebuilds via the same redacting pipeline, so no historical unredacted data is preserved or reintroduced. | PASS |

No violations to record in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-usage-insight-fidelity/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── parse-transcript.ts     # unchanged
│   ├── classify-outcome.ts     # unchanged
│   ├── extract-context.ts      # CHANGED: extractReasoning walks lines via parentUuid,
│   │                              not blocks within one line; detectValidation keyword
│   │                              set broadened; subagent-name matching moved here or
│   │                              to build-usage-event.ts as a small known-name set
│   ├── summarize-invocation.ts # NEW: pure per-tool `summary` renderer (FR-001-003)
│   ├── redact.ts                # unchanged
│   ├── build-usage-event.ts    # CHANGED: wires summarize-invocation, passes full
│   │                              `lines`/index into extractReasoning, uses the
│   │                              known-name set for isSubagent
│   └── summarize.ts             # CHANGED: bySubagent groups null/empty subagentType
│                                   under an "unknown_type" sentinel instead of skipping
├── ingest/
│   ├── discover-transcripts.ts # unchanged
│   ├── incremental-reader.ts   # unchanged
│   └── sync.ts                  # unchanged (already idempotent; reused by backfill)
├── storage/
│   ├── schema.ts                 # CHANGED: usage_events.summary column, schema_meta table
│   ├── repository.ts             # CHANGED: EventListRow/EventDetail carry `summary`
│   │                                instead of `inputPreview`; new backfill helpers
│   │                                (getLogicVersion/setLogicVersion/wipeDerivedTables)
│   └── backfill.ts               # NEW: runBackfillIfNeeded(db) — the FR-010 gate
├── server/
│   ├── http-server.ts            # unchanged (calls into routes.ts)
│   ├── routes.ts                  # unchanged surface, response shapes follow repository.ts
│   └── static/                    # CHANGED: renders `summary` instead of `inputPreview`
└── cli/
    └── main.ts                    # CHANGED: `runServe` calls runBackfillIfNeeded(db)
                                       before `listen()`

tests/
├── unit/            # + fixtures/tests for summarize-invocation, corrected
│                       extractReasoning (multi-line), corrected bySubagent grouping
├── integration/     # + backfill.test.ts (legacy logic_version triggers wipe+resync
│                       before server responds)
└── fixtures/         # + multi-line thinking/text/tool_use sequences, an "Agent"-named
                        delegation, a Bash call with/without `description`
```

**Structure Decision**: Unchanged from `001` — single project, same module boundaries.
This feature adds exactly two new files (`core/summarize-invocation.ts`,
`storage/backfill.ts`) and corrects logic inside existing files; it does not introduce a
new project, service, or client.

## Post-Design Constitution Check

*Re-evaluated after Phase 1 (research.md, data-model.md, contracts/api.md, quickstart.md).*

| Principle | Re-check against final design | Status |
|---|---|---|
| I. Simplicity First | `summarize-invocation.ts`'s per-tool renderers are a flat lookup by tool name plus a generic fallback — no rules engine, no config file, no ML/LLM call (data-model.md, research.md §1). Backfill is a single `logic_version` integer comparison, not a versioned migration chain. | PASS |
| II. Immutable Data, Pure Functions | `data-model.md`'s updated `UsageEvent` (adds `summary`) and `SubagentCount` (adds the `"unknown_type"` sentinel) remain plain readonly data. `extractReasoning`'s new signature takes the full `lines` array as an explicit read-only input and returns a value — still pure (research.md §2). | PASS |
| III. Composability Over Inheritance | `summarizeInvocation` composes into the existing `build-usage-event.ts` pipeline as one more step; subagent-name matching is a `ReadonlySet<string>` membership check composed into the existing `extractSubagentFields`, not a new type hierarchy. | PASS |
| IV. Decoupling Through Explicit Boundaries | `contracts/api.md` (this feature's delta) is still the one explicit boundary between server and frontend — `summary` replaces `inputPreview` there, nothing else about the boundary shape changes. `storage/backfill.ts` is called explicitly by `cli/main.ts`; no module reaches into another's internals. | PASS |
| V. Secure by Default | `summary` is built inside the pure core and passed through the same `redact()` call as every other free-text field before it can reach `build-usage-event.ts`'s output (research.md §1, §5) — confirmed no new code path writes an unredacted string to storage. | PASS |

No violations. Complexity Tracking table below is intentionally empty.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*No entries — no Constitution Check violations were identified in this plan.*
