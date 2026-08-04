# Quickstart: Validating Usage Insight Fidelity

This is a validation guide, to be run once the tasks in `tasks.md` are implemented — it
proves the fixes against the contracts in `contracts/api.md` and the entities in
`data-model.md`. It does not duplicate implementation code. Scenarios reference the real
local evidence gathered during planning (research.md) so you can sanity-check against your
own machine's data, not just fixtures.

## Prerequisites

- Node.js 20+
- An existing `~/.claude-observability/usage.db` populated by the prior (`001`) build —
  the point of Scenario 5 is to prove *that* data gets corrected, not just fresh data.
  If you don't have one, run a few Claude Code sessions first (including at least one that
  delegates to a subagent) before the fix is deployed, to have something to backfill.

## Setup

```bash
npm install
npm run build
npm start        # starts the localhost dashboard, e.g. http://127.0.0.1:4317
```

## Scenario 1 — Plain-language summaries, no raw JSON (User Story 1, FR-001–003, SC-001, SC-002)

1. Open the Tools view for a range covering recent activity.
2. **Expect**: every row's Summary column reads as a short phrase describing what
   happened (e.g. `` Edited `src/foo.ts` ``, `` Ran `npm test` ``), never a raw/escaped
   JSON fragment, never cut off mid-word.
3. Find a `Bash` invocation you know had a long, multi-flag or multi-command command.
   **Expect**: its summary is still a readable phrase (using its `description` if the
   agent supplied one, or a readable rendering of the command otherwise) — not the same
   truncated-JSON text the pre-fix `inputPreview` produced for that row.
4. Drill into that row's detail. **Expect**: the full raw `inputSummary` (unabridged) is
   still available there, distinct from the summary shown in the list (FR-003).

## Scenario 2 — Reasoning is actually captured (User Story 2, FR-004–005, SC-003)

1. Pick a session where you know (from having run it) that you stated your intent in a
   `thinking`/text turn immediately before a tool call.
2. Drill into that invocation. **Expect**: `reasoning` reflects what was actually said —
   not `null`/"not captured". This should now be common, not rare: contrast with the
   pre-fix state where `reasoning` was `null` for 100% of a real 6,991-event sample
   (research.md §1).
3. Pick an invocation from a turn where you know no reasoning was stated (a tool call with
   no preceding text/thinking line, or one broken by an intervening tool result).
   **Expect**: `reasoning: null`, still rendered as "not captured" — the fix must not
   fabricate reasoning that wasn't there (FR-005, Edge Cases).

## Scenario 3 — Validation is detected when it happened (User Story 2, FR-006–007, SC-004)

1. Pick (or construct) a session where an `Edit`/`Write`/mutating `Bash` call is followed
   within 1–2 turns by a tool call re-reading/re-checking the same target, with reasoning
   that expresses checking intent (explicit — "let me verify" — or implicit — "let me look
   at the file now").
2. Drill into the original invocation. **Expect**: `validation.result` is `confirmed` (or
   `mismatch_corrected` if the follow-up reasoning indicates a problem was found and
   fixed) — not `not_observed`.
3. Pick a read-only invocation (`Read`/`Grep`/etc.). **Expect**:
   `validation.result: not_applicable`, distinguished from `not_observed`.
4. Pick a mutating invocation with genuinely no follow-up check. **Expect**:
   `validation.result: not_observed` — still correctly reported as "nothing was observed,"
   not fabricated as `confirmed`.

## Scenario 4 — Subagent delegations show up, including unknown-type ones (User Story 3, FR-008–009, SC-005)

1. Run (or use existing history from) a session that delegates via whichever tool name
   your Claude Code build uses — this may be `Task` or `Agent` (research.md §3 found both
   in real use; older/newer builds may differ).
2. Open the Subagents view for a range covering that session. **Expect**: the delegation
   appears with its `subagentType`, count, and outcome — regardless of which of the two
   tool names produced it.
3. If any delegation in your data has a missing/empty `subagent_type` input, **expect** it
   to appear grouped under `"unknown_type"` (`GET /api/summary` → `bySubagent`), not
   silently absent from the view.
4. Drill into one delegation. **Expect**: its task/prompt and final outcome are shown,
   consistent with the existing per-invocation detail view (Assumptions: no deeper
   sidechain drill-down is in scope here).

## Scenario 5 — Historical sessions are corrected on deploy, no manual action (Edge Cases, FR-010, SC-006)

1. Before deploying this fix, note a session in your existing `usage.db` with (a) a
   summary you know reads as raw JSON, (b) `reasoning: null` for a call where reasoning
   was clearly stated, and/or (c) a subagent delegation that isn't showing up.
2. Deploy the fix and run `npm start` (or `observe serve`) fresh.
3. **Expect**: the server does not start listening until the backfill completes (it is
   blocking, per research.md §5) — the dashboard is only reachable once it has already
   rebuilt. Confirm via the process's stdout that the listen message appears only after
   backfill work is done, not before.
4. Reopen the session noted in step 1 (no manual sync/re-run needed). **Expect**: its
   summary is now plain language, its reasoning (if genuinely stated) is now populated,
   and its subagent delegation (if any) now appears — the same data the fix corrects for
   new sessions, retroactively applied without any action beyond restarting the server.
5. Restart the server a second time with no code changes. **Expect**: startup is fast (no
   full rebuild) — the `logic_version` already matches, so the backfill is a no-op.

## Scenario 6 — Redaction still applies to the new summary field (FR-011)

1. Construct a fixture invocation whose command/description contains a fake but
   pattern-matching secret (e.g. an `sk-...`-style token) inside the text that would
   otherwise become part of the summary (e.g. an `input.description` containing the
   secret).
2. Ingest it and inspect `usage_events.summary` directly in the SQLite file.
3. **Expect**: the secret pattern is replaced with `[REDACTED]` in `summary`, exactly as
   it already is in `reasoning`/`inputSummary` — the new field is not a bypass around
   existing redaction.
