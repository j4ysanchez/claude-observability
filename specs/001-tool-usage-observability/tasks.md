---

description: "Task list for Claude Code Tool & Subagent Usage Observability"
---

# Tasks: Claude Code Tool & Subagent Usage Observability

**Input**: Design documents from `/specs/001-tool-usage-observability/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md (all present)

**Tests**: Included. `plan.md`'s Technical Context and `research.md` §11 specify Vitest with
unit tests against the pure core (fixture-driven, no mocks) and integration tests against
real temp files/DB/HTTP for the boundary modules — this is treated as part of the planned
approach, not an optional add-on. Tests are not written strictly test-first; each story's
test tasks are listed before its implementation tasks for traceability, not as a TDD gate.

**Organization**: Tasks are grouped by user story (P1–P5 from spec.md) so each story is
independently implementable, testable, and deliverable as an incremental slice.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to its user story (US1–US5)
- Every task names an exact file path

## Path Conventions

Single project per plan.md Structure Decision — `src/`, `tests/` at repository root:

```text
src/core/     src/ingest/     src/storage/     src/server/ (+ static/)     src/cli/
tests/unit/   tests/integration/   tests/fixtures/
```

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bootstrap the Node/TypeScript project — this is a greenfield repo, no
`package.json` or `src/` exists yet.

- [X] T001 Create project directory structure per plan.md: `src/core/`, `src/ingest/`,
      `src/storage/`, `src/server/static/`, `src/cli/`, `tests/unit/`,
      `tests/integration/`, `tests/fixtures/`
- [X] T002 Initialize `package.json` at repo root: TypeScript 5.x, Node 20+ engines,
      `better-sqlite3` + `@types/better-sqlite3` + `@types/node` + `vitest` as
      dependencies, and npm scripts `build`, `start`, `sync`, `test` wired to
      `src/cli/main.ts` / `tsc` / `vitest`
- [X] T003 [P] Configure `tsconfig.json` at repo root: Node20/ES2022 target, strict mode,
      module resolution matching `better-sqlite3`'s CJS types
- [X] T004 [P] Configure `vitest.config.ts` at repo root covering `tests/unit/**` and
      `tests/integration/**`

**Checkpoint**: `npm install && npm test` runs (zero tests) with no errors.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure every user story builds on — transcript parsing
primitives, redaction, storage schema, and the localhost HTTP/CLI skeleton. No user story
work can start until this phase is complete (Constitution II/IV: pure core isolated from
I/O boundaries from the very first module).

**⚠️ CRITICAL**: This phase blocks all of Phase 3+.

- [X] T005 [P] Implement SQLite schema in `src/storage/schema.ts`: `sessions`,
      `usage_events`, `validation_checks`, `ingest_cursors` tables and all four indices,
      exactly as specified in data-model.md
- [X] T006 [P] Implement transcript discovery in `src/ingest/discover-transcripts.ts`:
      walk `~/.claude/projects/**/*.jsonl` and return the list of transcript file paths
- [X] T007 [P] Implement cursor-based incremental reader in
      `src/ingest/incremental-reader.ts`: given a file path and a stored byte offset,
      return only the new lines and the new offset (research.md §9)
- [X] T008 [P] Implement `redact(text: string): string` in `src/core/redact.ts`: regex
      patterns for AWS-style keys, `Bearer `/`sk-`/`ghp_`-style tokens, PEM private-key
      blocks, `password=`/`token=`/`apikey=` key-value pairs, replacing matches with
      `[REDACTED]` (research.md §7, FR-017)
- [X] T009 [P] Implement `classify-outcome.ts` in `src/core/classify-outcome.ts`: given a
      `tool_use` block and its matching `tool_result` (or none), return
      `succeeded | failed | denied | in_progress` per the rules in research.md §2
- [X] T010 [P] Implement `parse-transcript.ts` in `src/core/parse-transcript.ts`: parse one
      `.jsonl` line into a typed raw record, ignoring non-event line types (`summary`,
      `ai-title`, `attachment`, `file-history-snapshot`/`delta`, `queue-operation`,
      `last-prompt`) per research.md §1
- [X] T011 Implement base repository functions in `src/storage/repository.ts`: open/create
      the DB file at `~/.claude-observability/usage.db` (applying `schema.ts`), upsert/get
      `Session`, read/write `ingest_cursors` rows (depends on T005)
- [X] T012 [P] Implement the localhost-only HTTP listener in `src/server/http-server.ts`:
      binds `127.0.0.1` only (FR-011), accepts a route-dispatch callback
- [X] T013 Implement the CLI entry point in `src/cli/main.ts`: `node:util.parseArgs` for
      `serve`, `sync`, and `--port`, wiring `serve` to `http-server.ts` (depends on T011,
      T012)
- [X] T014 [P] Create shared fixture transcript excerpts in `tests/fixtures/`: ordinary
      tool success, tool error (`is_error: true`), permission denial (fixed rejection
      message), and a `Task`/subagent `tool_use` block (research.md §11)
- [X] T015 [P] Unit test `redact.ts` against secret-pattern fixtures in
      `tests/unit/redact.test.ts` (depends on T008)
- [X] T016 [P] Unit test `classify-outcome.ts` against success/error/denial fixtures in
      `tests/unit/classify-outcome.test.ts` (depends on T009, T014)
- [X] T017 [P] Unit test `parse-transcript.ts` against fixtures, including ignored
      non-event line types, in `tests/unit/parse-transcript.test.ts` (depends on T010,
      T014)
- [X] T018 [P] Integration test for `discover-transcripts.ts` + `incremental-reader.ts`
      against real temp files (including a re-run that only picks up newly appended
      lines) in `tests/integration/ingest.test.ts` (depends on T006, T007)
- [X] T019 [P] Integration test for `schema.ts` + repository session/cursor functions
      against a real temp SQLite DB in `tests/integration/storage.test.ts` (depends on
      T011)

**Checkpoint**: Foundation ready — `npm test` passes; user story implementation can begin.

---

## Phase 3: User Story 1 - See which tools I actually use (Priority: P1) 🎯 MVP

**Goal**: Developer opens the dashboard and sees an accurate breakdown of tool invocation
counts by type for a selectable time range, with a clear "no data yet" state when empty.

**Independent Test**: Run several sessions (real or fixture) using a variety of tools,
open the usage view, confirm accurate per-tool counts; with zero sessions, confirm a clear
"no data" message instead of a blank/misleading view.

### Tests for User Story 1

- [X] T020 [P] [US1] Unit test for the minimal `build-usage-event.ts` pipeline (session
      id/sequence/timestamp/toolName/isSubagent/outcome/projectPath, redaction applied) in
      `tests/unit/build-usage-event.test.ts`
- [X] T021 [P] [US1] Unit test for `summarize.ts` `byTool` aggregation, including the
      empty-array-not-omitted case, in `tests/unit/summarize.test.ts`
- [X] T022 [P] [US1] Integration test for `GET /api/status` and `GET /api/summary?range=`
      (empty DB, then populated) against a real temp transcript root + DB + HTTP server in
      `tests/integration/api-summary.test.ts`

### Implementation for User Story 1

- [X] T023 [US1] Implement the minimal pipeline in `src/core/build-usage-event.ts`:
      compose `parse-transcript` → `classify-outcome` → `redact` into a `UsageEvent` with
      `eventId`, `sessionId`, `sequence`, `timestamp`, `toolName`, `isSubagent` (`toolName
      === 'Task'`), `outcome`, `projectPath`; `reasoning`/`inputSummary`/`subagentType`/
      `subagentTask` left `null` for now (depends on T008, T009, T010)
- [X] T024 [US1] Implement `byTool` aggregation in `src/core/summarize.ts`: group
      `UsageEvent[]` by `toolName` into `{ toolName, count }[]`, empty array when no data
      (depends on T023)
- [X] T025 [US1] Implement `usage_events` write (upsert by `eventId`, idempotent) and
      `byTool`-scoped read query functions in `src/storage/repository.ts` (depends on
      T011, T023)
- [X] T026 [US1] Implement sync orchestration in `src/ingest/sync.ts`: for each discovered
      transcript, tail new lines via the cursor, run them through
      `build-usage-event.ts`, upsert rows, advance the cursor (depends on T006, T007,
      T023, T025)
- [X] T027 [US1] Implement `GET /api/status` in `src/server/routes.ts`: run sync first,
      then return `hasTranscriptSource`, `transcriptRoot`, `sessionCount`,
      `lastIngestAt`, and a distinct `message` for "no transcript root" vs. "zero
      sessions" per contracts/api.md (depends on T026)
- [X] T028 [US1] Implement `GET /api/summary?range=` in `src/server/routes.ts`: run sync
      first, return `byTool` from T024; `bySubagent` returns `[]` until US3 populates it
      (depends on T024, T026)
- [X] T029 [US1] Wire `routes.ts` into `http-server.ts` request dispatch in
      `src/server/http-server.ts` (depends on T012, T027, T028)
- [X] T030 [US1] Build the dashboard shell and tool breakdown view in
      `src/server/static/index.html`, `src/server/static/app.js`,
      `src/server/static/styles.css`: range selector (today/7d/30d/all), per-tool count
      table, outcome badges (FR-009), and the "no data" message from `/api/status`
      rendered instead of a blank table (FR-010) (depends on T027, T028, T029)

**Checkpoint**: User Story 1 is fully functional and independently testable/demoable.

---

## Phase 4: User Story 2 - Understand why and how each tool was used (Priority: P2)

**Goal**: Drilling into any invocation surfaces the reasoning that prompted it, the
specific input/parameters used, and any observed validation step and its outcome —
distinguishing "not captured" from "not applicable."

**Independent Test**: Run a session where the agent uses several tools for different
reasons; confirm drill-down surfaces reasoning, input, and validation outcome per
invocation, with missing data shown as "not available" rather than fabricated.

### Tests for User Story 2

- [X] T031 [P] [US2] Add fixtures to `tests/fixtures/`: a message with preceding
      reasoning text before a `tool_use`, a message with no preceding text, an
      `Edit`-then-`Read`-of-same-file validation sequence (confirmed), an edit followed by
      corrected re-work (mismatch_corrected), and a read-only tool call (not_applicable)
- [X] T032 [P] [US2] Unit test for `extract-context.ts` covering reasoning capture
      (FR-012), input serialization (FR-013), and all four validation-check outcomes
      (FR-014/FR-016) in `tests/unit/extract-context.test.ts` (depends on T031)
- [X] T033 [P] [US2] Integration test for `GET /api/events` and `GET /api/events/:eventId`
      (including a `reasoning: null` and a `validation.result: not_applicable` case) in
      `tests/integration/api-events.test.ts`

### Implementation for User Story 2

- [X] T034 [US2] Implement `extract-context.ts` in `src/core/extract-context.ts`:
      backward-walk preceding `text`/`thinking` blocks for reasoning (null if none),
      serialize `tool_use.input` for the input summary, and the validation-check
      heuristic (confirmed/mismatch_corrected/not_observed/not_applicable) per
      research.md §4–§6 (depends on T008)
- [X] T035 [US2] Wire `extract-context.ts` into `build-usage-event.ts`: populate
      `reasoning` and `inputSummary`, and emit an associated `ValidationCheck` when
      detected, in `src/core/build-usage-event.ts` (depends on T023, T034)
- [X] T036 [US2] Implement `validation_checks` write and an event-detail query (joins
      `usage_events` + `validation_checks` by `event_id`) in `src/storage/repository.ts`
      (depends on T025, T035)
- [X] T037 [US2] Implement `GET /api/events?range=&tool=&subagentType=&sessionId=&page=`
      in `src/server/routes.ts`: paginated list rows with `hasReasoning`/`hasValidation`
      flags per contracts/api.md (depends on T036)
- [X] T038 [US2] Implement `GET /api/events/:eventId` in `src/server/routes.ts`: full
      detail with `reasoning`, `inputSummary`, and `validation` (or `null`) per
      contracts/api.md (depends on T036)
- [X] T039 [US2] Build the event list + detail drill-down view in `src/server/static/`:
      clicking a breakdown row opens a filtered event list; clicking an event opens a
      detail panel rendering why/how/validation, visibly distinguishing "not captured"
      from "not applicable" (FR-016) (depends on T037, T038, T030)

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Understand subagent usage specifically (Priority: P3)

**Goal**: A dedicated subagent view shows each subagent type, its invocation count, its
outcome breakdown, and — per invocation — the task it was given and how it concluded.

**Independent Test**: Run sessions delegating to multiple subagent types; confirm the
subagent view shows type, count, and outcome for each, and drilling into one shows its
task and final outcome, including an `in_progress` case for a still-running delegation.

### Tests for User Story 3

- [X] T040 [P] [US3] Add fixtures to `tests/fixtures/`: multiple `Task` invocations with
      different `subagent_type` values and outcomes, including one with no matching
      `tool_result` yet (in_progress)
- [X] T041 [P] [US3] Unit test for `bySubagent` aggregation (per-type count + outcome
      breakdown) in `tests/unit/summarize.test.ts` (depends on T040)
- [X] T042 [P] [US3] Integration test for subagent breakdown in `GET /api/summary` and
      drill-down via `GET /api/events/:eventId` (task + outcome, incl. `in_progress`) in
      `tests/integration/api-summary.test.ts`

### Implementation for User Story 3

- [X] T043 [US3] Extend `build-usage-event.ts` to populate `subagentType` and
      `subagentTask` (redacted `description`/`prompt`) from the `Task` tool's `input` when
      `isSubagent` is true (FR-002/FR-003) in `src/core/build-usage-event.ts` (depends on
      T035)
- [X] T044 [US3] Extend `summarize.ts` to compute `bySubagent`: per-`subagentType` count
      and an `outcomes` breakdown across all four outcome values (FR-006) in
      `src/core/summarize.ts` (depends on T024)
- [X] T045 [US3] Wire `bySubagent` into the `GET /api/summary` response in
      `src/server/routes.ts` (was `[]`) (depends on T028, T044)
- [X] T046 [US3] Build the subagent usage view in `src/server/static/`: per-type counts
      and outcome breakdown, drilling into an invocation reuses the US2 detail view to
      show task/outcome (depends on T045, T039)

**Checkpoint**: User Stories 1–3 are all independently functional.

---

## Phase 6: User Story 4 - See how usage changes over time (Priority: P4)

**Goal**: A trends view plots/lists tool and subagent invocation counts per day/week,
including zero-activity periods shown as zero rather than omitted.

**Independent Test**: Generate usage data across 8+ distinct days (crossing a week
boundary); confirm the trend view accurately shows day-over-day/week-over-week counts,
with days of no activity shown as zero.

### Tests for User Story 4

- [X] T047 [P] [US4] Add fixtures spanning 8+ distinct days, including at least one day
      with zero activity, to `tests/fixtures/`
- [X] T048 [P] [US4] Unit test for trend bucketing (day and week granularity, one bucket
      per period including zero-activity buckets) in `tests/unit/summarize.test.ts`
      (depends on T047)
- [X] T049 [P] [US4] Integration test for `GET /api/trend?range=&granularity=` in
      `tests/integration/api-trend.test.ts`

### Implementation for User Story 4

- [X] T050 [US4] Implement trend bucketing in `src/core/summarize.ts`: date-bucketed
      `toolCounts`/`subagentCounts` per day or week across the requested range, always one
      entry per bucket (FR-007) (depends on T024, T044)
- [X] T051 [US4] Implement `GET /api/trend?range=&granularity=` in `src/server/routes.ts`
      per contracts/api.md (depends on T050)
- [X] T052 [US4] Build the trend view in `src/server/static/`: bar/sparkline markup per
      day/week for tool and subagent counts, no charting library (depends on T051, T030)

**Checkpoint**: User Stories 1–4 are all independently functional.

---

## Phase 7: User Story 5 - Drill into a session's tool sequence (Priority: P5)

**Goal**: Opening a specific session shows its ordered sequence of tool/subagent
invocations, each openable into the why/how/validation detail from User Story 2.

**Independent Test**: Pick a completed session with multiple invocations; confirm the
drill-down view lists them in chronological order with type and outcome, each opening
into its detail view.

### Tests for User Story 5

- [X] T053 [P] [US5] Integration test for `GET /api/sessions?range=` and
      `GET /api/sessions/:sessionId/events` (chronological `sequence` order, `status`
      derived per research.md §8) in `tests/integration/api-sessions.test.ts`

### Implementation for User Story 5

- [X] T054 [US5] Implement a sessions rollup query in `src/storage/repository.ts`: list
      sessions with `eventCount` and derived `status` (`in_progress` iff `now -
      lastEventAt < 5 minutes`, else `concluded`) (depends on T011, T025)
- [X] T055 [US5] Implement `GET /api/sessions?range=` in `src/server/routes.ts` per
      contracts/api.md (depends on T054)
- [X] T056 [US5] Implement `GET /api/sessions/:sessionId/events` in
      `src/server/routes.ts`: same row shape as `GET /api/events`, filtered to the
      session, sorted by `sequence` ascending (depends on T037)
- [X] T057 [US5] Build the session list + chronological timeline view in
      `src/server/static/`: session list → ordered event sequence → opens into the US2
      detail view for any entry (depends on T055, T056, T039)

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation and checks that span every story.

- [ ] T058 [P] Run every scenario in quickstart.md end-to-end against the built dashboard
      and record results
- [ ] T059 [P] Write `README.md` at repo root covering install/build/start/sync usage
- [ ] T060 Verify redaction on disk (quickstart Scenario 7): ingest a fixture with a
      pattern-matching secret, inspect `~/.claude-observability/usage.db` directly, and
      confirm no raw secret is ever present, not just hidden by the UI
- [ ] T061 Seed ~10^5 `usage_events` rows in a temp DB and confirm `GET /api/summary` and
      `GET /api/trend` respond in <200ms (Performance Goals in plan.md)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. Blocks every user story.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational + US1's `build-usage-event.ts`
  (T023) and repository/route scaffolding (T025, T028, T030) that it extends in place.
- **User Story 3 (Phase 5)**: Depends on Foundational + US2's `build-usage-event.ts`
  (T035) and `summarize.ts`/`routes.ts`/static view it extends (T024, T028, T039).
- **User Story 4 (Phase 6)**: Depends on Foundational + US1/US3's `summarize.ts` (T024,
  T044) and static shell (T030).
- **User Story 5 (Phase 7)**: Depends on Foundational + US1's repository/event shape
  (T025) and US2's event row shape/detail view (T037, T039).
- **Polish (Phase 8)**: Depends on all desired user stories being complete.

Note: unlike a typical spec-kit feature where stories are fully independent, US2–US5 here
each extend the *same* shared files (`build-usage-event.ts`, `summarize.ts`,
`routes.ts`, the static frontend) that US1 establishes — this follows directly from the
data model (data-model.md: `SubagentInvocation` and validation are the same
`usage_events`/`validation_checks` tables, not separate entities). Each story is still
independently *testable* (its own acceptance scenarios pass once its tasks land) and
independently *demoable*, but later stories are implemented sequentially after earlier
ones, not in parallel by different people touching the same files.

### Within Each User Story

- Tests are listed before implementation for traceability (not a strict TDD gate here).
- Core pure-function changes before storage changes before route changes before the
  static view.
- Story complete (checkpoint) before starting the next priority.

### Parallel Opportunities

- Setup: T003, T004 in parallel once T002 lands.
- Foundational: T005–T010 and T012, T014 all touch different files and can run in
  parallel; T015–T019 (tests) can run in parallel with each other once their respective
  implementation tasks land.
- Within each story's "Tests" subsection, all `[P]` tasks touch different files and can
  run in parallel.
- Implementation tasks within a story are mostly sequential (shared files); see each
  story's task list for exact same-file dependencies.

---

## Parallel Example: Foundational Phase

```bash
# Once T001-T004 (Setup) are done, launch these together:
Task: "Implement SQLite schema in src/storage/schema.ts"
Task: "Implement transcript discovery in src/ingest/discover-transcripts.ts"
Task: "Implement cursor-based incremental reader in src/ingest/incremental-reader.ts"
Task: "Implement redact() in src/core/redact.ts"
Task: "Implement classify-outcome.ts in src/core/classify-outcome.ts"
Task: "Implement parse-transcript.ts in src/core/parse-transcript.ts"
Task: "Implement the localhost-only HTTP listener in src/server/http-server.ts"
Task: "Create shared fixture transcript excerpts in tests/fixtures/"
```

## Parallel Example: User Story 1 Tests

```bash
Task: "Unit test for build-usage-event.ts in tests/unit/build-usage-event.test.ts"
Task: "Unit test for summarize.ts byTool aggregation in tests/unit/summarize.test.ts"
Task: "Integration test for GET /api/status and GET /api/summary in tests/integration/api-summary.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (blocks everything)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run quickstart.md Scenarios 1–2 against real or fixture data
5. This is a demoable MVP — a working localhost dashboard showing tool usage breakdown

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. + User Story 1 → validate against quickstart Scenarios 1–2 → demo (MVP)
3. + User Story 2 → validate against quickstart Scenario 3 → demo
4. + User Story 3 → validate against quickstart Scenario 4 → demo
5. + User Story 4 → validate against quickstart Scenario 5 → demo
6. + User Story 5 → validate against quickstart Scenario 6 → demo
7. Polish → validate quickstart Scenarios 7–8 (redaction, denied vs. failed) and
   performance goals

---

## Notes

- `[P]` tasks = different files, no dependency on an incomplete task.
- `[Story]` label maps a task to its user story for traceability.
- Because US2–US5 extend shared files established by US1 (see Dependencies note above),
  treat the story phases as sequential increments, not independently parallelizable
  workstreams — each is still independently testable via its own quickstart scenario.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently before continuing.
