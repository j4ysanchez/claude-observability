# Feature Specification: Claude Code Tool & Subagent Usage Observability

**Feature Branch**: `[001-tool-usage-observability]`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "My goal is to introduce observability into claude code. What are the high value things to measure and derive insights from? Interview me to help build this specification"

## Clarifications

### Session 2026-08-03

- Q: Should the system capture raw tool inputs/parameters as-is, or apply safeguards against capturing sensitive data (secrets, credentials, proprietary content)? → A: Auto-redact known secret patterns (API keys, tokens, passwords, etc.) by default before persisting; keep everything else raw.
- Q: Should usage views be scoped/filterable per project, or shown as one combined stream across all of the developer's local projects? → A: Combined view only in this version; project is retained as event-level metadata/context, not exposed as a filter.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See which tools I actually use (Priority: P1)

As a developer using Claude Code, I want to see a breakdown of which tools (file edits, file reads, shell commands, search, web fetches, subagent delegations, etc.) are being invoked and how often, so that I understand my real usage patterns instead of guessing from memory.

**Why this priority**: This is the foundational insight — without knowing what's being used at all, no other analysis (trends, subagent behavior, friction points) is possible. It's also the smallest slice that delivers standalone value.

**Independent Test**: Can be fully tested by running several Claude Code sessions that use a variety of tools, then opening the usage view and confirming it shows an accurate count/breakdown of tool invocations by type. Delivers value on its own even with no other stories implemented.

**Acceptance Scenarios**:

1. **Given** one or more completed Claude Code sessions that invoked multiple different tools, **When** the developer opens the tool usage view, **Then** they see each tool type listed with an accurate invocation count for the selected time range.
2. **Given** no Claude Code sessions have produced any usage data yet, **When** the developer opens the tool usage view, **Then** the system clearly states that no data is available yet rather than showing a blank or misleading report.

---

### User Story 2 - Understand why and how each tool was used (Priority: P2)

As a developer, I want to drill into any individual tool invocation and see why the agent chose to use it (the task/reasoning behind the call), how it used it (the specific input, parameters, or target of the call), and whether the agent checked the result against what it expected, so that I can judge whether tool usage was deliberate, correct, and self-correcting rather than blind or wasteful.

**Why this priority**: Raw usage counts (Story 1) tell you *what* happened but not whether it was purposeful or effective. This contextual layer is what turns a usage log into an actual insight tool, and was called out as being just as important as the raw counts — so it's ranked immediately after the foundational breakdown.

**Independent Test**: Can be fully tested by running a session where the agent uses several tools for clearly different reasons, then confirming that drilling into each invocation surfaces the reasoning that prompted it, the specific input/parameters used, and any observed validation step and its outcome.

**Acceptance Scenarios**:

1. **Given** a specific tool invocation, **When** the developer drills into it, **Then** they see the reasoning or task context that led the agent to make that call.
2. **Given** a specific tool invocation, **When** the developer drills into it, **Then** they see the specific input/parameters used (e.g., which file was edited, which command was run, which search query was issued) — not just the tool's name.
3. **Given** a tool invocation where the agent had an expected outcome, **When** the developer drills into it, **Then** they see whether and how the agent checked the actual result against that expectation (e.g., re-reading a file after editing it, checking a command's output, re-running a test) and what happened if the check failed.
4. **Given** a tool invocation where no reasoning, parameter detail, or validation step was captured, **When** the developer drills into it, **Then** the view clearly states that information was not available rather than fabricating it.

---

### User Story 3 - Understand subagent usage specifically (Priority: P3)

As a developer, I want to see which subagents are being delegated tasks, how often, and what kind of work they're given, so that I can judge whether subagent delegation is being used effectively and for what purposes.

**Why this priority**: Subagent usage was explicitly called out as a primary area of interest — it's a distinct behavior pattern from ordinary tool calls (a delegation decision, not just an action) and warrants its own dedicated view, but it builds on the same underlying capture mechanism as Stories 1 and 2.

**Independent Test**: Can be fully tested by running sessions that invoke different subagent types for different tasks, then confirming the usage view shows each subagent type, its invocation count, and the outcome of each invocation.

**Acceptance Scenarios**:

1. **Given** sessions that delegated tasks to multiple different subagent types, **When** the developer opens the subagent usage view, **Then** they see each subagent type with its invocation count and outcome (completed, failed, still running) for the selected time range.
2. **Given** a specific subagent invocation, **When** the developer drills into it, **Then** they can see what task it was given and how it concluded.

---

### User Story 4 - See how usage changes over time (Priority: P4)

As a developer, I want to see tool and subagent usage trends across days and weeks, so that I can notice shifts in how I'm working with Claude Code (e.g., adopting a new tool, relying more on subagents, less manual searching).

**Why this priority**: Trend analysis depends on having usage data already captured and broken down (Stories 1–3); it adds longitudinal insight on top of a point-in-time snapshot, which is valuable but not required for an initial useful MVP.

**Independent Test**: Can be fully tested by generating usage data across multiple distinct days, then confirming the trend view accurately shows day-over-day or week-over-week changes in invocation counts.

**Acceptance Scenarios**:

1. **Given** usage data spanning multiple days, **When** the developer opens the trends view, **Then** they see invocation counts plotted or listed per day/week for both tools and subagents.
2. **Given** a time range with no recorded activity (e.g., a day with no Claude Code usage), **When** the developer views that range, **Then** it is shown as zero activity rather than being silently omitted or causing an error.

---

### User Story 5 - Drill into a session's tool sequence (Priority: P5)

As a developer, I want to open a specific session and see the ordered sequence of tools and subagents it used, so that I can understand the actual flow of a task rather than only aggregate counts.

**Why this priority**: This is a supporting/diagnostic capability that adds depth once aggregate and per-invocation views (Stories 1–4) already exist; it's valuable for investigating a specific session but not essential to the core "what am I using" insight.

**Independent Test**: Can be fully tested by picking a completed session and confirming the drill-down view lists its tool/subagent invocations in the order they occurred.

**Acceptance Scenarios**:

1. **Given** a completed session with multiple tool invocations, **When** the developer selects that session, **Then** they see the invocations listed in chronological order with type and outcome for each, and can open any one of them into the why/how/validation detail from Story 2.

---

### Edge Cases

- What happens when Claude Code's usage telemetry is not enabled/configured on the developer's machine? The system MUST clearly explain that no data is being captured and point to what needs to be turned on, rather than silently showing empty views.
- How does the system handle a session that is interrupted or crashes mid-way, leaving only partial usage data? Partial data MUST still be captured and shown as-is, not discarded.
- How are denied or failed tool invocations (e.g., the developer rejected a permission prompt, or a tool errored) treated versus successful ones? They MUST be recorded and visually distinguishable, not merged into success counts.
- What happens when multiple Claude Code sessions run concurrently on the same machine? Usage events from each MUST be correctly attributed to their own session, not merged or mis-attributed.
- What happens when there are gaps in captured data (e.g., machine was asleep/offline while a session ran)? Gaps MUST be visible as missing data rather than presented as zero activity.
- What happens when the agent didn't articulate any reasoning before making a tool call? The context view MUST show "no reasoning captured" rather than inferring or guessing one.
- What happens when a tool call has no natural expected output to validate (e.g., a read-only lookup)? The view MUST show validation as "not applicable," distinct from "expected but not observed."
- What happens when the agent's own output-validation step itself fails or contradicts an earlier claim of success? The system MUST surface the contradiction rather than only showing the last-reported status.
- What happens when a tool invocation's captured input/reasoning contains what looks like a secret or credential? It MUST be redacted before persisting, replaced with a clear placeholder (e.g., "[REDACTED]") so the developer can still see that a value was passed without exposing it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST capture every tool invocation made during a Claude Code session, recording at minimum: tool name, timestamp, session identifier, and outcome (succeeded, failed, or denied).
- **FR-002**: System MUST distinguish subagent invocations from ordinary tool calls and MUST capture the subagent type/name delegated to.
- **FR-003**: System MUST capture, for each subagent invocation, the task it was given and its eventual outcome (completed, failed, or still in progress).
- **FR-004**: System MUST persist captured usage data locally so it remains available for querying after the originating session has ended and across machine restarts.
- **FR-005**: Users MUST be able to view a breakdown of tool usage (invocation counts by tool type) for a selectable time range (e.g., today, last 7 days, last 30 days, all time).
- **FR-006**: Users MUST be able to view a breakdown of subagent usage (invocation counts by subagent type, with task context and outcomes) for a selectable time range.
- **FR-007**: Users MUST be able to view how tool and subagent usage changes over time (day-over-day or week-over-week).
- **FR-008**: Users MUST be able to drill down from an aggregate breakdown into the individual session(s) that contributed to it, and from a session into its chronological sequence of tool/subagent invocations.
- **FR-009**: System MUST visually distinguish successful, failed, and denied tool invocations in all usage views.
- **FR-010**: System MUST clearly indicate when no usage data is available (e.g., telemetry not enabled, or no sessions run yet) rather than presenting an empty view as if it were complete data.
- **FR-011**: System MUST operate entirely on the developer's local machine, requiring no external account, remote service, or network connectivity to capture, store, or view usage data.
- **FR-012**: System MUST capture the reasoning or task context that prompted each tool invocation, to the extent the agent articulated it, so the developer can see *why* a tool was used.
- **FR-013**: System MUST capture the specific input, parameters, or target of each tool invocation (e.g., which file, which command, which query) so the developer can see *how* a tool was used, not just that it was used.
- **FR-014**: System MUST capture, where the agent performed an observable follow-up action to check a tool's result against what it expected (e.g., re-reading a changed file, checking a command's output, re-running a test), that validation step and its outcome (confirmed match, detected mismatch and corrected course).
- **FR-015**: Users MUST be able to view, for any individual tool invocation, its captured reasoning (why), invocation detail (how), and validation outcome (if any) together in one place.
- **FR-016**: System MUST clearly distinguish, for each of reasoning, invocation detail, and validation, between "not available/not captured" and "not applicable to this tool," rather than presenting all missing information the same way.
- **FR-017**: System MUST automatically redact known secret/credential patterns (e.g., API keys, tokens, passwords) from captured tool inputs, parameters, and reasoning text before persisting them, replacing the redacted portion with a clear placeholder rather than storing it raw.
- **FR-018**: System MUST present usage breakdowns, trends, and drill-downs as a single combined view across all of the developer's local projects; per-project filtering is out of scope for this version, though each Usage Event still retains its project/working-directory context (FR-001).

### Key Entities

- **Usage Event**: A single tool invocation captured from a Claude Code session — includes tool name, timestamp, session identifier, working directory/project context, outcome (succeeded, failed, denied), the reasoning/task context that prompted it (why), and the specific input/parameters used (how), with known secret/credential patterns redacted before persistence.
- **Subagent Invocation**: A specialized Usage Event representing a delegation to a subagent — includes subagent type, the task/prompt it was given, and its outcome (completed, failed, in progress).
- **Validation Check**: An agent-performed follow-up action that confirms or contradicts the expected result of a Usage Event (e.g., re-reading a file after an edit, checking a command's exit status, re-running a test) — includes what was checked, and its outcome (confirmed expected result, detected mismatch/correction taken, not observed, not applicable).
- **Session**: A single Claude Code run/conversation that groups an ordered sequence of Usage Events, with a start time, end time (if concluded), and associated project.
- **Usage Summary**: An aggregated view (counts by tool or subagent type, grouped by a selected time range) derived from underlying Usage Events, used to power the breakdown and trend views.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can identify their top 5 most-used tools over any selected time range in under 30 seconds, without manually reviewing session transcripts.
- **SC-002**: A developer can identify every subagent type invoked "today" and how many times, without manually reviewing session transcripts.
- **SC-003**: Usage data from a session remains fully queryable at least 30 days after that session ended, with no manual export or backup step required by the developer.
- **SC-004**: 100% of tool and subagent invocations from a completed session are reflected in the usage views within one minute of the session ending.
- **SC-005**: A developer can determine whether their tool or subagent usage this week differs from the prior week without writing a custom query or script.
- **SC-006**: When telemetry is not enabled, a developer can determine why no data is showing within 15 seconds of opening the usage view.
- **SC-007**: For any selected tool invocation, a developer can determine why the agent chose that tool and specifically what it did, without reading the raw session transcript.
- **SC-008**: For tool invocations where the agent had an expected outcome, a developer can determine whether the agent verified that outcome — and what it did if the result didn't match — without reading the raw session transcript.

## Assumptions

- Claude Code's native usage telemetry (its existing metrics, logs, and session transcript export) is the source of truth for observed activity; this spec assumes that data is enabled and accessible, rather than requiring new instrumentation to be built into Claude Code itself.
- Recommended approach: consume Claude Code's native telemetry export and persist the resulting events into a local, lightweight data store, rather than relying solely on a live/streaming view. Local persistence is treated as a requirement (FR-004) because trend analysis (User Story 4) and 30-day availability (SC-003) both require history that a live-only export would not retain.
- This version targets a single developer running Claude Code locally on their own machine. Multi-user aggregation, team rollups, and centralized/org-wide access control are explicitly out of scope for this spec, though the underlying data model (Usage Event, Session) should not preclude such a rollup being built later.
- "Subagent usage" refers to Claude Code's agent/task delegation mechanism (e.g., Explore, Plan, general-purpose, and other named subagent types) as distinct from direct tool calls made by the main assistant.
- "Why" (reasoning) is derived from the agent's own stated reasoning in the session transcript at or around the time of the tool call (e.g., preceding assistant text/thinking, or the task it was given). The system reports what the agent articulated — it does not infer or invent intent the agent never stated.
- "Validation" is observed opportunistically: it depends on the agent itself performing a visible follow-up action in the transcript (e.g., re-reading a file, checking a result, re-running a test). The system does not independently re-verify whether a tool call was objectively correct — it only reports what the agent itself did to check its own work, if anything.
- No authentication or access control is required, since this is single-user, local-only operation with no network exposure.
- Per-project filtering is out of scope for this version (see FR-018); the developer sees one combined view across all local projects, with project retained as context on each event for potential future filtering.
- Default data retention is indefinite on local disk for this initial version; automatic pruning/retention limits are a reasonable future enhancement, not a requirement here, since event-level usage telemetry is small relative to typical local disk capacity.
