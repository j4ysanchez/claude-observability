# Phase 0 Research: Claude Code Tool & Subagent Usage Observability

All items below were previously open ("recommended approach" language in spec
Assumptions, or left to `/speckit-plan` per the spec-quality checklist notes). Each is
resolved here with a decision, rationale, and alternatives considered.

## 1. Data source & transcript format

**Decision**: Read Claude Code's existing per-session transcripts directly:
`~/.claude/projects/<sanitized-cwd>/<session-id>.jsonl`, one JSON object per line.
Confirmed by inspecting real local transcripts:
- Each line has a `type` (`user`, `assistant`, plus non-event lines like `summary`,
  `ai-title`, `attachment`, `file-history-snapshot`/`delta`, `queue-operation`,
  `last-prompt` that are not usage events and are ignored).
- `assistant` lines carry `message.content[]` blocks of type `text`, `thinking`, and
  `tool_use` (`{name, input}`).
- `user` lines carry the corresponding `message.content[]` blocks of type `tool_result`
  (`{tool_use_id, is_error?, content}`).
- Every line has `sessionId`, `timestamp`, `cwd`, `gitBranch`, `uuid`, `parentUuid`.
- Subagent delegation is a normal `tool_use` block with `name: "Task"` and
  `input: {subagent_type, description, prompt, run_in_background?}`.

**Rationale**: This is already the durable, append-only record of everything Claude Code
did in a session — matches the spec's Assumption that native telemetry/transcripts are
the source of truth, and requires zero new instrumentation inside Claude Code.

**Alternatives considered**: A live event-stream/hook-based capture (e.g., Claude Code
hooks firing on each tool call) was considered but rejected for v1 — it would require the
developer to configure hooks project-by-project and only captures events going forward,
whereas transcript parsing works retroactively on all existing history with no setup.

## 2. Outcome classification (succeeded / failed / denied)

**Decision**: For each `tool_use` block, find its matching `tool_result` (by
`tool_use_id`) in the following `user` line(s):
- No matching `tool_result` yet in the transcript → `in_progress`.
- `tool_result.content` (as string) matches the fixed permission-rejection message
  Claude Code emits ("The user doesn't want to proceed with this tool use. The tool use
  was rejected...") → `denied`.
- `tool_result.is_error === true` (and not the denial message above) → `failed`.
- Otherwise → `succeeded`.

**Rationale**: Confirmed by grepping real transcripts — permission denials produce a
distinct, fixed content string on the `tool_result`, cleanly distinguishable from a
command/tool genuinely erroring (`is_error: true` with tool-specific error output). This
satisfies FR-009 and the spec's edge case requiring denied/failed to be visually and
data-level distinct, not merged into success counts.

**Alternatives considered**: Treating any `is_error: true` as "failed" without checking
content would misclassify user-denied permission prompts as tool failures, which the spec
edge cases explicitly call out as wrong.

## 3. Subagent detection & outcome

**Decision**: A `UsageEvent` is a `SubagentInvocation` when `tool_name === "Task"`.
`subagent_type` and `subagent_task` (the `description`/`prompt`) come from `input`.
Outcome reuses the same succeeded/failed/denied/in_progress classification against the
`Task` tool's own `tool_result` (which contains the subagent's final summarized output).

**Rationale**: Matches spec Assumptions ("Subagent usage" = Claude Code's `Task`
delegation mechanism) and FR-002/FR-003. Confirmed against a real transcript containing a
`Task` call with `subagent_type: "general-purpose"`.

**Alternatives considered**: Parsing the sidechain conversation (`isSidechain: true`
lines that represent the subagent's own internal transcript) for a richer "how it
concluded" was considered, but the outer `Task` tool_result already contains the
subagent's final report, which is sufficient for FR-003/FR-006; sidechain parsing is
noted as a possible future enhancement, not required for these functional requirements.

## 4. Reasoning capture ("why", FR-012)

**Decision**: For a given `tool_use` block, walk backwards through the same assistant
message's preceding `text`/`thinking` content blocks (same `message.content[]` array,
before the `tool_use` block) and use the nearest non-empty one as the captured reasoning.
If none exists in that message, reasoning is `null` ("not captured"), never inferred.

**Rationale**: Directly matches the spec Assumption that "why" is the agent's own stated
reasoning at or around the time of the call, with "no reasoning captured" as an explicit,
distinguishable state (edge cases, FR-016).

## 5. Input/parameter capture ("how", FR-013)

**Decision**: Serialize the `tool_use.input` object (tool-specific: `file_path` for
Read, `command` for Bash, `subagent_type`/`prompt` for Task, etc.) as the captured input,
after redaction (§7). No tool-specific allowlist of "interesting" fields — capture the
whole `input` object so no tool type needs special-casing to satisfy FR-013.

**Rationale**: Every tool's `input` already contains exactly the parameters that
determine "how" it was used; capturing it generically keeps the core simple (Principle I)
and correct-by-construction for future/unknown tool types.

## 6. Validation-check detection ("did it check its work", FR-014)

**Decision**: Heuristic, opportunistic detection only (per spec Assumptions — no
independent re-verification): after a `tool_use` that mutates state (`Edit`, `Write`,
`Bash` that looks like a test/build run), scan the same session's subsequent 1–2
assistant turns for a `tool_use` that re-reads/re-checks the same target (e.g., a `Read`
of the same `file_path` just edited, or another `Bash` call) preceded by reasoning text
that references verifying/confirming/checking the prior result. If found, outcome is
`confirmed` (result matches) or `mismatch_corrected` (reasoning text indicates a problem
was found and corrected); if the tool type has no natural expected result to check
(e.g., a read-only `Read`/`Grep`), mark `not_applicable`; otherwise `not_observed`.

**Rationale**: Matches the spec's explicit boundary: the system reports only what the
agent itself visibly did, never invents or independently re-verifies correctness. The
four-way state (`confirmed` / `mismatch_corrected` / `not_observed` / `not_applicable`)
maps directly onto FR-016's requirement to distinguish "not captured" from "not
applicable."

**Alternatives considered**: A stricter rule requiring an LLM-based judgment of whether a
validation "really" occurred was rejected as unnecessary complexity (Principle I) and
inconsistent with the spec's assumption that validation is reported, not judged.

## 7. Secret/credential redaction (FR-017)

**Decision**: A pure `redact(text: string): string` function in `core/redact.ts` applies
a fixed set of well-known regex patterns (AWS-style keys, generic `Bearer `/`sk-`/`ghp_`
style tokens, `-----BEGIN ... PRIVATE KEY-----` blocks, `password=`/`token=`/`apikey=`
style key-value pairs, and other common high-entropy secret shapes) to every string field
before it becomes part of a `UsageEvent` (`reasoning`, `input_summary`, `subagent_task`,
validation `checked_what`) — i.e., before the boundary write to SQLite, never after.
Matches are replaced with `[REDACTED]`.

**Rationale**: FR-017 requires redaction *before persisting*; doing it as the last step
of the pure core pipeline (not in the storage boundary) means nothing unredacted is ever
constructed as a value that could accidentally be written or logged (Principle V, Secure
by Default).

**Alternatives considered**: Redacting at read time (query/display) instead of at write
time was rejected — it would mean raw secrets sit on disk in the SQLite file, violating
the "before persisting" requirement and Secure by Default.

## 8. Session boundary & "in progress" status

**Decision**: A `Session` has `started_at` = timestamp of its first transcript line and
`last_event_at` = timestamp of its most recently ingested line. There is no explicit
"session ended" event in the transcript format, so status is derived at query time:
`in_progress` if `last_event_at` is within a 5-minute freshness window of "now" (ingest
time), else `concluded`. This only affects display status, not what data is captured or
retained (FR-004 persists everything regardless).

**Rationale**: Simplest rule that satisfies User Story 3's "still running" outcome state
and the edge case for interrupted/crashed sessions (partial data is captured and shown
as-is either way, per FR-004 and the edge cases).

**Alternatives considered**: Watching for a process-exit signal from Claude Code itself
was rejected — no such signal is exposed to an external local tool, and would add a
dependency on Claude Code internals beyond the transcript file it already writes.

## 9. Ingestion trigger (how data gets from transcript to database)

**Decision**: Pull-based, incremental, on-demand: every API request that needs fresh
data first runs a cheap sync step — for each transcript file, compare its current size
against the byte offset stored in `ingest_cursors` (§ data-model), and if it has grown,
read only the new lines, run them through the core pipeline, and upsert the resulting
rows. No background daemon or filesystem watcher.

**Rationale**: Matches Simplicity First — a watcher process adds lifecycle complexity
(start/stop, crash recovery, running when the dashboard isn't even open) that isn't
needed to satisfy SC-004 ("within one minute of the session ending"), since that
requirement is about the view being accurate when opened, not about background push
delivery. Cursor-based tailing also makes ingestion idempotent and safe to re-run.

**Alternatives considered**: A long-running `fs.watch`-based daemon was considered (would
also satisfy SC-004) but rejected as unnecessary process-management complexity for a
single-user local tool where "open the dashboard" is already the trigger the spec's user
stories assume.

## 10. Runtime, storage, and UI stack

**Decision**: TypeScript on Node.js 20+; `better-sqlite3` for storage; Node's built-in
`http` + `util.parseArgs` for the server and CLI; a dependency-free static HTML/CSS/JS
frontend (fetch calls against the JSON API, plain DOM rendering, no charting library —
trends rendered as simple bar/sparkline markup).

**Rationale**: All of Simplicity First, Immutable Data/Pure Functions, and Decoupling
are easiest to satisfy without a web framework, ORM, or SPA framework for a single-page,
single-user, read-mostly local dashboard. `better-sqlite3`'s synchronous API avoids
async/await ceremony throughout the storage boundary for a tool that never has concurrent
writers.

**Alternatives considered**: A TUI (terminal dashboard, e.g. via a curses-style library)
was considered as an alternative to a web dashboard; rejected because the spec's user
stories describe drill-down/trend views that are materially easier to present clearly as
tables/charts in a browser, and a local HTTP server is no heavier a dependency than a TUI
library. A full SPA framework (React) was rejected per Simplicity First — no second
concrete use case (e.g., a second consuming client) justifies the extra build tooling.

## 11. Testing stack

**Decision**: Vitest. Unit tests exercise `core/*` pure functions directly against
fixture `.jsonl` excerpts (checked into `tests/fixtures/`) covering: ordinary tool
success, tool error, permission denial, a `Task`/subagent call, a validation-check
sequence, and inputs containing secret-like strings. Integration tests exercise
`ingest/*`, `storage/*`, and `server/*` against real temporary files/DB/HTTP calls.

**Rationale**: Matches the constitution's Development Workflow directive: pure core
tested with real inputs/outputs and no test doubles; boundary modules covered by
integration tests where the actual effects (file I/O, SQL, HTTP) occur.
