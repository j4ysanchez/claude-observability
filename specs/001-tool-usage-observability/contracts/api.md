# Contract: Local Dashboard JSON API

The only external interface this feature exposes is the JSON API served by
`src/server/` to its own static frontend, both bound to `127.0.0.1` (FR-011 — no
external network exposure, no auth, single local user). Every `GET` handler runs the
incremental sync step (research.md §9) before answering, so responses always reflect the
latest on-disk transcripts.

Time ranges accepted by every range-scoped endpoint: `today | 7d | 30d | all` (FR-005).
Trend endpoints additionally accept `granularity=day|week` (FR-007).

## GET /api/status

Reports whether any data is available at all — powers FR-010 / SC-006 (telemetry not
enabled / no sessions yet).

Response:
```json
{
  "hasTranscriptSource": true,
  "transcriptRoot": "/Users/you/.claude/projects",
  "sessionCount": 0,
  "lastIngestAt": null,
  "message": "No Claude Code sessions found yet. Run Claude Code at least once, then reopen this dashboard."
}
```
`hasTranscriptSource: false` (the `~/.claude/projects` directory itself is missing) is
the "telemetry not enabled" case from the Edge Cases; `sessionCount: 0` with
`hasTranscriptSource: true` is the "no sessions yet" case. Each carries a distinct
`message` per FR-010.

## GET /api/summary?range=

Tool + subagent breakdown for the range (FR-005, FR-006, SC-001, SC-002).

```json
{
  "range": "7d",
  "generatedAt": "2026-08-03T20:00:00.000Z",
  "byTool": [{ "toolName": "Bash", "count": 42 }],
  "bySubagent": [
    { "subagentType": "Explore", "count": 5,
      "outcomes": { "succeeded": 4, "failed": 0, "denied": 0, "in_progress": 1 } }
  ]
}
```
Empty arrays (not a 404/omission) when there is no data for the range — see data-model.md
Usage Summary validation rules.

## GET /api/trend?range=&granularity=

Time-bucketed counts (FR-007, User Story 4).

```json
{
  "range": "30d",
  "granularity": "day",
  "buckets": [
    { "bucket": "2026-07-28", "toolCounts": { "Bash": 10, "Read": 6 }, "subagentCounts": { "Explore": 1 } },
    { "bucket": "2026-07-29", "toolCounts": {}, "subagentCounts": {} }
  ]
}
```
Every bucket in the requested range is present, including zero-activity buckets (Edge
Cases: "time range with no recorded activity ... shown as zero activity rather than
silently omitted").

## GET /api/events?range=&tool=&subagentType=&sessionId=&page=

Paginated list of `UsageEvent` rows for drill-down (FR-008), filterable by tool name,
subagent type, or session. All filters optional and combinable; `sessionId` filter
additionally sorts by `sequence` (session drill-down, User Story 5).

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
      "inputPreview": "{\"file_path\":\"src/core/redact.ts\",\"old_string\":\"OLD…"
    }
  ]
}
```
List responses include only enough to render a row + navigate to detail; full
reasoning/input/validation text is fetched via the detail endpoint below to keep list
payloads small. `inputPreview` is `inputSummary` truncated to 80 characters (`null` when
no input was captured) — enough to show what a tool acted on (e.g. a bash command or file
path) directly in the list, without the unbounded full text.

## GET /api/events/:eventId

Full detail for one invocation — why / how / validation together (FR-015).

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
  "reasoning": "Fixing the redaction regex to also match `sk-` prefixed tokens.",
  "inputSummary": "{\"file_path\":\"src/core/redact.ts\",\"old_string\":\"...\",\"new_string\":\"...\"}",
  "validation": { "checkedWhat": "Re-read redact.ts after the edit", "result": "confirmed" }
}
```
`reasoning: null` renders as "not captured"; `validation: null` renders as
"not applicable" or "not observed" per its own `result` field — see FR-016. The client
never fabricates text for a null field.

## GET /api/sessions?range=

List of sessions with lightweight rollup stats, for browsing into a session's timeline
(FR-008, User Story 5).

```json
{
  "sessions": [
    { "sessionId": "sess123", "projectPath": "/Users/you/dev/foo", "startedAt": "...",
      "lastEventAt": "...", "status": "concluded", "eventCount": 12 }
  ]
}
```

## GET /api/sessions/:sessionId/events

Chronological event sequence for one session (User Story 5, FR-008), same row shape as
`GET /api/events` filtered to that session and always sorted by `sequence` ascending.
