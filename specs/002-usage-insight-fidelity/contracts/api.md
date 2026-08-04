# Contract: Local Dashboard JSON API — Changes for Usage Insight Fidelity

This is a delta on top of `specs/001-tool-usage-observability/contracts/api.md`, which
remains the base contract (same endpoints, same `127.0.0.1`-only binding, same
`range`/`granularity` params). Only endpoints whose response shape changes are shown here;
every other endpoint (`GET /api/status`, `GET /api/trend`, `GET /api/sessions`,
`GET /api/sessions/:sessionId/events`) is unchanged in shape — `GET /api/trend`'s
`subagentCounts` values are affected in *content* (an `"unknown_type"` key may now appear,
data-model.md), not in shape.

**New behavior for every endpoint**: on `serve` startup, before the HTTP listener accepts
its first connection, a one-time blocking backfill runs if the stored `logic_version`
doesn't match the build's (research.md §5). No endpoint is reachable until it completes —
there is no partial/stale-data response state to document, because the server simply
hasn't started listening yet.

## GET /api/summary?range=

`bySubagent` may now include an entry grouping delegations whose type could not be
determined (FR-009):

```json
{
  "range": "7d",
  "generatedAt": "2026-08-03T20:00:00.000Z",
  "byTool": [{ "toolName": "Bash", "count": 42 }],
  "bySubagent": [
    { "subagentType": "Explore", "count": 5,
      "outcomes": { "succeeded": 4, "failed": 0, "denied": 0, "in_progress": 1 } },
    { "subagentType": "unknown_type", "count": 1,
      "outcomes": { "succeeded": 0, "failed": 0, "denied": 0, "in_progress": 1 } }
  ]
}
```
`"unknown_type"` is a reserved sentinel value for `subagentType` (data-model.md), used
only when the underlying delegation's own `subagent_type` input was missing/empty/null —
never for an unfamiliar-but-present custom subagent name, which is shown as its own
distinct `subagentType` entry.

## GET /api/events?range=&tool=&subagentType=&sessionId=&page=

`inputPreview` (a truncated slice of raw JSON — the bug this feature fixes, per its
Summary) is **replaced** by `summary`: a full, plain-language, never-truncated
description (FR-001, FR-002).

```json
{
  "page": 1,
  "pageSize": 50,
  "total": 3,
  "events": [
    {
      "eventId": "sess123:uuid456",
      "sessionId": "sess123",
      "sequence": 4,
      "timestamp": "2026-08-03T19:58:00.000Z",
      "toolName": "Edit",
      "isSubagent": false,
      "outcome": "succeeded",
      "hasReasoning": true,
      "hasValidation": true,
      "summary": "Edited `src/core/redact.ts`"
    },
    {
      "eventId": "sess123:uuid789",
      "sessionId": "sess123",
      "sequence": 5,
      "timestamp": "2026-08-03T19:59:00.000Z",
      "toolName": "Bash",
      "isSubagent": false,
      "outcome": "succeeded",
      "hasReasoning": true,
      "hasValidation": false,
      "summary": "Ran `npm test`"
    }
  ]
}
```
Unlike `inputPreview`, `summary` is never truncated by the server — it is a short phrase
or sentence by construction (research.md §4), so list payloads stay small without an
artificial character cap. The full raw `inputSummary` this replaces as the list-row hint
is still available, unabridged, from the detail endpoint below (FR-003).

`subagentType` in the query string may be `unknown_type` to filter the events list down to
delegations grouped under that sentinel (consistent with `GET /api/summary`'s
`bySubagent`).

## GET /api/events/:eventId

Gains `summary` alongside the existing fields (FR-001, FR-015):

```json
{
  "eventId": "sess123:uuid456",
  "sessionId": "sess123",
  "timestamp": "2026-08-03T19:58:00.000Z",
  "toolName": "Edit",
  "isSubagent": false,
  "subagentType": null,
  "subagentTask": null,
  "outcome": "succeeded",
  "summary": "Edited `src/core/redact.ts`",
  "reasoning": "Fixing the redaction regex to also match `sk-` prefixed tokens.",
  "inputSummary": "{\"file_path\":\"src/core/redact.ts\",\"old_string\":\"...\",\"new_string\":\"...\"}",
  "validation": { "checkedWhat": "Re-read redact.ts after the edit", "result": "confirmed" }
}
```
`summary` and `inputSummary` are both always present (`summary` is never `null`;
`inputSummary` keeps its existing `string | null` semantics, unchanged from `001`).
`reasoning: null` still renders as "not captured"; `validation: null`/its `result` field
still distinguishes "not applicable" from "not observed" exactly as in `001` — this
feature corrects how reliably those states are detected (research.md §1–2), not their
shape or meaning.
