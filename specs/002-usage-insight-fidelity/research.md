# Phase 0 Research: Usage Insight Fidelity

Unlike `001`, none of these are open design choices in the abstract — each is a bug in an
existing implementation. Every decision below is grounded in direct inspection of (a) real
`.jsonl` transcripts under `~/.claude/projects/`, and (b) the already-populated local
database at `~/.claude-observability/usage.db` (6,991 `usage_events` rows, one project,
built by the current `001` pipeline). Numbers cited are exact counts from that inspection,
run during this planning session.

## 1. Why reasoning is captured 0% of the time (FR-004, FR-005)

**Finding**: `src/core/extract-context.ts`'s `extractReasoning` is called from
`build-usage-event.ts` as `extractReasoning(blocks.slice(0, blockIndex))`, where `blocks`
is `contentBlocks(line)` — the content-block array of the *same transcript line* as the
`tool_use`. `001`'s research.md §4 assumed a transcript line's `message.content[]` can
contain multiple blocks (`[text, tool_use]`, `[thinking, tool_use]`, etc.) in one line.

Sampling every assistant line across all 11 transcripts in
`~/.claude/projects/-Users-jsanchez-dev-claude-observability/` (673 assistant lines)
found **zero** lines with more than one content block. Every line's `content` array has
exactly one element: `('tool_use',)`, `('thinking',)`, or `('text',)`. `thinking`, `text`,
and `tool_use` blocks that conceptually belong to the same model turn each arrive as their
own **consecutive JSONL line**, not as siblings in one array. Confirmed the linkage is
structural, not incidental: a `tool_use` line's `parentUuid` equals the `uuid` of the
immediately preceding `thinking`/`text` line (spot-checked directly, e.g. tool_use line
`uuid=580b0733…` has `parentUuid=46f25555…`, which is exactly the `uuid` of the prior
`thinking` line).

Because `blocks.slice(0, blockIndex)` is always evaluated against a single-block array
with the `tool_use` at index 0, the "preceding blocks" slice is always `[]` — reasoning is
architecturally incapable of ever being non-null under the current implementation. This
is confirmed empirically: `SELECT COUNT(*) FROM usage_events WHERE reasoning IS NOT NULL`
against the local DB returns `0` out of `6991`.

**Decision**: Redefine the "same assistant turn, immediately preceding text" walk (per
this feature's clarification) at the *line* level instead of the *block* level: given the
ordered `lines` array and the index of a `tool_use` line, walk backward through
immediately preceding entries that are `type: "assistant"`, contain exactly the one
`text`/`thinking` block, and are linked by `parentUuid` (each line's `parentUuid` equals
the previous line's `uuid`) — stopping at the first line that breaks that chain (a
`tool_use`/`tool_result`/`user` line, a missing/mismatched parent, or the start of the
batch). Return the nearest non-empty `text`/`thinking` content found, `null` if the chain
breaks immediately — identical semantics to `001`'s original intent, corrected to the
real transcript shape. `extractReasoning`'s signature becomes
`extractReasoning(lines, lineIndex): string | null` (still pure, still takes explicit
inputs, no hidden state).

**Alternatives considered**: Walking backward by array index alone (without checking
`parentUuid`) was considered and rejected — it happens to work for the common
single-branch case but is not robust against interleaved lines (e.g. a background task's
lines interleaved by timestamp rather than turn order); the `parentUuid` chain is the
actual, documented relationship Claude Code uses to express turn structure, so matching on
it is both correct and no more complex to implement.

## 2. Why validation is essentially never detected (FR-006, FR-007)

**Finding**: `detectValidation` (`extract-context.ts`) only reaches `confirmed` or
`mismatch_corrected` if a candidate follow-up tool call's preceding reasoning
(`extractReasoning(...)`) is non-null *and* matches `VERIFY_KEYWORDS`. Since reasoning is
always `null` today (§1), the `if (checkReasoning === null || ...) continue;` guard always
fires — `confirmed`/`mismatch_corrected` are unreachable in practice. Confirmed against the
local DB: `validation_checks.result` is `not_applicable` (2,032) or `not_observed` (4,959)
for all 6,991 events; `confirmed` and `mismatch_corrected` each occur `0` times.

This is a downstream symptom of §1, not an independent defect — fixing reasoning
extraction is a prerequisite for validation detection to do anything at all. But it is not
sufficient on its own: `VERIFY_KEYWORDS` currently requires an explicit verification word
(`verify`, `confirm`, `re-read`, `re-check`, `ensure`, …) in the *check line's* reasoning.
Real agent reasoning frequently expresses the same intent without those exact words (e.g.
"Let me look at the file now" or "Checking the output"). Once reasoning starts populating
(§1's fix), an unchanged, narrow keyword list would still under-detect relative to FR-006's
"reliably detect ... when genuinely present" bar.

**Decision**: Keep `detectValidation` a heuristic (no LLM judgment — same constraint as
`001`'s Assumptions and this constitution's Simplicity First), but (a) fix its dependency
on `extractReasoning` per §1, and (b) broaden `VERIFY_KEYWORDS` to also match common
implicit-check phrasing (`check`, `checking`, `looking at`, `let me see`, `let's see`,
`re-run`, `rerun`, `look at the`, `read it back`) alongside the existing explicit terms —
still a fixed regex list, no new architecture, just a wider net now that it has real
reasoning text to run against.

**Alternatives considered**: Dropping the reasoning-gate requirement entirely (treat *any*
same-target follow-up tool call as a check, regardless of stated reasoning) was rejected —
it would conflate "the agent happened to touch the same file again for an unrelated
reason" with "the agent checked its work," which is exactly the false-positive risk the
original heuristic was designed to avoid (spec Edge Cases: never invent validation that
didn't happen).

## 3. Why subagent delegations don't show up (FR-008, FR-009)

**Finding**: `build-usage-event.ts`'s `extractSubagentFields`/`isSubagent` both hardcode
`toolUse.name === "Task"`. Grepping the same local transcripts for actual delegation tool
calls found **two** distinct tool names in use, both with the identical
`input.subagent_type` / `description` / `prompt` shape `001`'s research.md §3 documented:
`"Task"` (14 occurrences in the sampled project) and `"Agent"` (62 occurrences, same
project — e.g. `{"description":"Implement Phase 3 User Story 1","subagent_type":
"general-purpose","prompt":"..."}`). Confirmed directly against the local DB:
`is_subagent = 1` for exactly 14 rows (the `"Task"`-named calls only); all 62 `"Agent"`-
named calls are stored as ordinary, non-subagent tool events — invisible to any subagent
view. (This environment's own tool listing corroborates this: the delegation tool visible
in this very session is named `Agent`, not `Task` — Claude Code's delegation tool name is
not a stable constant across builds/versions.)

Separately, `summarize.ts`'s `bySubagent` has `if (!event.isSubagent || event.subagentType
=== null) { continue; }` — any delegation whose type couldn't be determined is dropped
from the aggregation entirely, not grouped, contradicting FR-009's explicit "unknown type"
requirement.

**Decision**: Match delegation by a small `ReadonlySet<string>` of known tool names
(`"Task"`, `"Agent"`) instead of one literal — both names observed in real local data,
both carrying the same `input` shape, so no other extraction logic changes. Fix
`bySubagent` (and the equivalent grouping in `trend()`'s `subagentCounts`) to map a
`null`/empty `subagentType` to an explicit `"unknown_type"` sentinel key instead of
skipping the event, per FR-009/the edge case.

**Alternatives considered**: Detecting delegation structurally (any `tool_use` whose
`input` contains a `subagent_type` field, regardless of tool name) was considered as a
more future-proof alternative to a name allowlist. Rejected for v1 as slightly riskier
(a non-delegation tool could coincidentally define an `input.subagent_type`-shaped
parameter) without a corresponding requirement driving it; the two-name set already
covers 100% of observed real data and is trivial to extend later if a third name appears
(Simplicity First — solve the problem that's actually present).

## 4. Plain-language summary (FR-001, FR-002, FR-003)

**Finding**: The most recent commit (`0d6c75d`, "Added summary for tool use") added
`EventListRow.inputPreview` = `inputSummary.slice(0, 80) + "…"`, where `inputSummary` is
already `redact(JSON.stringify(toolUse.input))` — i.e. exactly the escaped, wall-of-JSON
raw parameter dump the spec's User Story 1 complains about, now additionally truncated
mid-structure (e.g. mid-command, mid-quote). Sampling real `Bash` `inputSummary` values
from the local DB confirms this directly: multi-line, multi-command, quote-escaped
commands sliced arbitrarily at 80 characters.

The same sampling also found a reusable, already-present signal: **35% of real `Bash`
calls (1,254 of 3,544) already carry a non-empty `input.description`** — a short,
natural-language label the agent itself wrote when invoking the tool (e.g. `"Run
verification script"`, `"Run parsing unit tests"`). This field is part of several tools'
own input schema, not something this feature has to infer from scratch.

**Decision**: Add a new field, `summary: string` (always non-null — every invocation gets
*some* readable description, per FR-001), built by a new pure function,
`core/summarize-invocation.ts`, composed into the existing `build-usage-event.ts`
pipeline, in priority order:
1. If `input.description` is a non-empty string, use it (redacted) directly — it is
   already agent-authored natural language.
2. Otherwise, a small per-tool-name renderer for the highest-volume tools observed
   locally (`Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Task`/`Agent`, `WebFetch`,
   `WebSearch`, `TodoWrite`) producing a short phrase from that tool's well-known input
   fields (e.g. `Read` → `` Read `<path>` ``; `Edit` → `` Edited `<path>` ``; `Bash`
   with no description → the command's first whitespace-delimited token(s) as the verb,
   e.g. `` Ran `npm test` `` for a simple command, or `` Ran a n-step shell command
   starting with `<first token>` `` for a multi-command chain split on top-level
   `&&`/`;`/`|` — never the raw JSON-escaped string).
3. Otherwise (an unrecognized tool with no `description`) — a generic fallback:
   `` Ran <ToolName> `` plus, if `input` has exactly one short string-valued field, that
   value appended plainly (not JSON-stringified). This satisfies the spec's Assumption
   that a "clearly formatted, readable rendering... not raw truncated JSON" is an
   acceptable floor for unusual cases, without requiring a bespoke renderer for every
   possible tool.

`summary` passes through the same `redact()` call as every other free-text field before
it becomes part of a `UsageEvent` (FR-011). It is never truncated by the API layer
(replacing `inputPreview` — list responses return the full `summary`; only CSS ellipsis
may visually clip it, with the full text available on hover/detail, satisfying FR-002).
The existing `inputSummary` (raw, unabridged, redacted `JSON.stringify(input)`) is
unchanged and remains available via the detail endpoint, satisfying FR-003's "raw stays
accessible as separate detail."

**Alternatives considered**: Calling out to an LLM to generate the summary was rejected —
this tool is offline-only by design (`001` FR-011/Constraints), and a fixed, pure,
deterministic renderer is trivially unit-testable against fixtures (Principle II) in a way
a model call is not. A single generic "first N chars of the command, formatted with line
breaks" renderer (no per-tool logic, no `description` preference) was considered simpler,
but was rejected because it would ignore the `description` field 35% of Bash calls already
provide for free, and because a bare command string, however nicely line-wrapped, does not
satisfy FR-001's "plain language describing what the invocation did" for tools like `Edit`
or `Task` where the interesting information (file path, delegated task) isn't the first
token of a command string.

## 5. Historical re-evaluation (FR-010)

**Finding**: `syncTranscripts` (`ingest/sync.ts`) is purely additive: for each transcript
it compares current file size to a stored `ingest_cursors.byte_offset` and reads only the
bytes past that offset. It has no mechanism to revisit bytes already consumed under the
old, buggy logic — the 6,991 events already in the local DB will never be touched by
incremental sync again, regardless of how many times the dashboard is opened, because
their transcripts have already been fully consumed (cursor at end-of-file).

**Decision**: Add a `schema_meta` table holding a single `logic_version` value. At
`serve` startup (`cli/main.ts`, before `listen()` is called — i.e. before the HTTP
listener can accept a single request, matching this feature's clarification that
re-evaluation must be a "blocking backfill... before any view can be opened"), a new
`storage/backfill.ts` module compares the stored `logic_version` against a constant baked
into this build. If they differ (or no row exists yet): wipe `sessions`, `usage_events`,
`validation_checks`, and `ingest_cursors` (all four — not a partial patch), then call the
existing `syncTranscripts(db)` unmodified, which re-reads every transcript from byte 0
through the corrected pipeline and rebuilds everything; finally write the new
`logic_version`. If they already match, this is a no-op single `SELECT`. The `sync` CLI
subcommand (`cli/main.ts`'s `runSync`) gets the same gate for consistency, since it is
also a valid first entry point.

**Rationale**: The transcript files remain the durable source of truth (per `001`'s
Assumptions, reaffirmed by this feature's Assumptions) — nothing is lost by discarding and
rebuilding the derived SQLite rows from them. A full rebuild is simpler (Simplicity First)
than writing bespoke "detect and patch only the wrong rows" migration logic, is naturally
idempotent (re-running an already-current-version DB is a no-op), and reuses the existing,
already-tested `syncTranscripts` pipeline verbatim rather than adding a second ingestion
code path.

**Alternatives considered**: Incrementally re-processing only rows that look
"under-filled" (e.g. `reasoning IS NULL`) was rejected — it can't distinguish "genuinely
no reasoning was stated" (a valid, must-be-preserved state per FR-005) from "reasoning
extraction was buggy," so it cannot be correct without re-deriving from source anyway;
once you must re-read the transcript, wiping and rebuilding is the simpler path. Running
the backfill asynchronously in the background after `listen()` starts was rejected because
the clarification explicitly requires no view to be openable against stale data — a
background job racing the first request would violate that guarantee.

## 6. Runtime, storage, and UI stack

**Decision**: Unchanged from `001` §10 — TypeScript/Node 20+, `better-sqlite3`, Node
built-in `http`/`parseArgs`, dependency-free static frontend. No new dependency is needed
for any of the five fixes above.

**Rationale**: All five root causes are logic bugs in the existing pure core or a small,
boundary-only addition (the backfill gate); none require new infrastructure.

## 7. Testing stack

**Decision**: Unchanged from `001` §11 — Vitest, fixture-driven unit tests for `core/*`,
integration tests for the boundary modules. New fixtures needed: a multi-line
`thinking`/`text`/`tool_use` sequence (linked by `parentUuid`) reflecting the corrected
transcript model (§1); a `Bash` call with and without `input.description` (§4); an
`"Agent"`-named delegation alongside a `"Task"`-named one in the same fixture set (§3); a
validation sequence whose check-turn reasoning uses implicit phrasing rather than an
explicit "verify" keyword (§2). New integration test: starting `serve` against a DB
carrying a stale `logic_version` must fully rebuild before the first HTTP response is
served (§5).
