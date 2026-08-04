# Feature Specification: Usage Insight Fidelity

**Feature Branch**: `[002-usage-insight-fidelity]`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "The problems I want to solve:
- The summary doesn't really tell me anything. it's truncated and the bash command is not straight forward to read
- There are no reasoning notes, and there is no validation.
- No subagents are being traced."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand an invocation at a glance from its summary (Priority: P1)

As a developer reviewing the Tool & Subagent Usage view, I want each invocation's summary to describe what it actually did in plain language, so that I don't have to decode a truncated, raw parameter dump (e.g., a wall of escaped JSON) just to know what a `Bash` command or other tool call was for.

**Why this priority**: The summary column is the first and most frequent thing a developer looks at — it appears on every single row of every list. If it's unreadable, the view fails at its most basic job before a developer ever drills into anything else. It's also the problem the user raised first.

**Independent Test**: Can be fully tested by running a session that includes a variety of invocations (including a non-trivial multi-flag `Bash` command), opening the Tools view, and confirming every row's summary reads as a short, complete, human-understandable description rather than a cut-off raw command/parameter string.

**Acceptance Scenarios**:

1. **Given** a `Bash` invocation with a long or complex command, **When** the developer views its row in the Invocations list, **Then** the summary describes what the command does in plain language and is not a truncated fragment of the raw command text.
2. **Given** any tool invocation, **When** the developer views its summary, **Then** the summary is a complete sentence or phrase (not cut off mid-word or mid-structure) that fits legibly in the list view.
3. **Given** a developer wants the exact raw command/parameters behind a summary, **When** they drill into the invocation, **Then** the full raw input is still available there (the summary simplifies the list view; it does not hide the underlying detail).

---

### User Story 2 - See the reasoning and validation behind an invocation (Priority: P2)

As a developer drilling into a tool invocation, I want to reliably see the reasoning that led to the call and whether its result was checked, so that the "why" and "validation" columns are useful signal instead of always reading "Not captured" / "—" for sessions where the agent clearly did articulate its reasoning or did check its work.

**Why this priority**: This is the second problem raised, and it's what turns the usage log into an insight tool rather than a plain event list — but it depends on invocations already being visible and readable (Story 1).

**Independent Test**: Can be fully tested by running a session where the transcript clearly contains the agent's stated reasoning before a tool call and a clear follow-up check afterward (e.g., re-reading an edited file), then confirming both the reasoning and validation columns reflect that content instead of showing "not captured"/"not observed" for cases where it plainly exists in the transcript.

**Acceptance Scenarios**:

1. **Given** a session where the agent stated its reasoning for a tool call in the same assistant turn, immediately before that call, **When** the developer drills into that invocation, **Then** the reasoning shown reflects what the agent actually said.
2. **Given** a session where the agent performed an observable follow-up check on a tool's result, **When** the developer drills into that invocation, **Then** the validation outcome reflects that the check happened (and whether it confirmed the result or found and corrected a mismatch).
3. **Given** an invocation where the agent genuinely stated no reasoning and performed no observable check, **When** the developer drills into it, **Then** the view still correctly shows "not captured" / "not observed" — the fix must not invent reasoning or validation that never happened.
4. **Given** a tool with nothing meaningful to validate (e.g., a read-only lookup), **When** the developer drills into it, **Then** validation is shown as "not applicable," distinct from "not observed."

---

### User Story 3 - See subagent delegations show up at all (Priority: P3)

As a developer, I want subagent (Task) delegations to reliably appear in the Subagents view with their type, count, and outcome, so that I can actually see this category of activity instead of the view showing nothing despite subagents having been used.

**Why this priority**: This was the third problem raised. It depends on the underlying invocation capture already working (Stories 1–2) but is its own distinct, currently broken capability — subagent delegation is a first-class activity type this tool is meant to surface, and today it surfaces none.

**Independent Test**: Can be fully tested by running a session that delegates to one or more subagent types, opening the Subagents view, and confirming those delegations appear with an accurate count and outcome — where today the view shows none.

**Acceptance Scenarios**:

1. **Given** a session that delegated work to at least one subagent, **When** the developer opens the Subagents view for a time range covering that session, **Then** the delegation appears with its subagent type, an invocation count, and its outcome.
2. **Given** a subagent delegation whose specific type cannot be determined from the session data, **When** the developer opens the Subagents view, **Then** that delegation still appears (grouped under a clearly labeled "unknown type" bucket) rather than being silently omitted from the view entirely.
3. **Given** a specific subagent delegation, **When** the developer drills into it, **Then** they see the task it was given and how it concluded, consistent with the existing per-invocation detail view.

---

### Edge Cases

- What happens when a `Bash` command has no clear single "intent" (e.g., a long piped chain of unrelated commands)? The summary MUST still give the developer a reasonable, honest description of what ran, rather than fabricating a simpler intent than what actually happened.
- What happens when reasoning text is genuinely absent from the transcript, not just missed by a detection gap? The view MUST continue to show "not captured" — fixing detection gaps must not turn into inventing reasoning that was never stated.
- What happens when a subagent's type field is missing, empty, or null? It MUST still be counted and shown, under an "unknown type" grouping, not dropped. A present, non-empty type value (including an unfamiliar or custom subagent name) is shown as its own specific type — it is not folded into "unknown type" merely for being unfamiliar.
- What happens to previously ingested sessions that predate this fix? Their invocations MUST be re-evaluated so summaries, reasoning, validation, and subagent visibility are corrected retroactively, not only for newly captured sessions going forward.
- What happens when a summary or reasoning/validation text is long? It MUST be presented in full without silent truncation in the drill-down detail view, even if the list view shows a shortened form.

## Clarifications

### Session 2026-08-03

- Q: FR-004 says reasoning must be captured when articulated "at or reasonably near" a tool call, but doesn't define that proximity window. How should "reasonably near" be scoped when associating stated reasoning with a specific tool call? → A: Same-turn, immediately preceding text — only the text/thinking immediately before that tool call within the same assistant turn counts as its reasoning.
- Q: FR-010 requires previously ingested sessions to be re-evaluated with corrected logic, with SC-006 requiring no manual action from the developer. What timing/mechanism should this re-evaluation use? → A: Blocking backfill before first use — all historical sessions are reprocessed synchronously as part of deploying the fix, before any view can be opened, guaranteeing fully corrected data from the first view.
- Q: The edge case says a subagent type that is "malformed or unrecognized" must still be shown under an "unknown type" grouping. Since Claude Code supports an open-ended set of custom, user-defined subagent names, what should count as "unrecognized"? → A: Missing/empty/null only — any other non-empty string, including unfamiliar custom subagent names, is shown as its own specific type; only a missing, empty, or null type field is grouped as "unknown type."

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display, for every tool invocation, a concise summary written in plain language describing what the invocation did, rather than a raw or truncated serialization of its parameters.
- **FR-002**: Summaries in the primary list view MUST NOT be cut off mid-word or mid-structure in a way that leaves the developer unable to tell what the invocation did; if a summary is shortened for list-view display, the complete, untruncated version MUST be available in that invocation's drill-down detail.
- **FR-003**: For invocations of tools that run a raw command or query (e.g., `Bash`), the summary MUST prioritize describing the action's intent in readable language; the exact raw command/parameters MUST remain accessible as separate detail, not as the primary summary.
- **FR-004**: System MUST capture and surface the agent's stated reasoning for a tool call whenever that reasoning was genuinely articulated in the session transcript immediately before that tool call within the same assistant turn (the same-turn text/thinking directly preceding the call), correcting current cases where reasoning that was actually stated is nonetheless shown as "not captured."
- **FR-005**: System MUST continue to show reasoning as "not captured" for invocations where the agent genuinely articulated none — improving detection MUST NOT result in fabricated or inferred reasoning.
- **FR-006**: System MUST reliably detect validation follow-up actions (e.g., re-reading a changed file, re-checking a command's output, re-running a test) when they are genuinely present in the transcript, correcting current cases where an observable check is nonetheless shown as "not observed."
- **FR-007**: System MUST continue to distinguish "not observed" (the agent did not check) from "not applicable" (the tool had nothing meaningful to check) for validation outcomes.
- **FR-008**: System MUST include every subagent (Task) delegation in the Subagent usage view, with its invocation count and outcome, for the selected time range.
- **FR-009**: System MUST NOT silently omit a subagent delegation from the Subagent usage view because its specific subagent type could not be determined; such delegations MUST instead be grouped and labeled as an identifiable "unknown type" so their existence and count remain visible. A delegation is only treated as "unknown type" when its type field is missing, empty, or null; any other non-empty type value — including unfamiliar or custom subagent names — MUST be shown as its own specific type, not folded into "unknown type."
- **FR-010**: System MUST re-evaluate previously ingested sessions against the corrected summary, reasoning, validation, and subagent-detection logic so that historical sessions reflect the same fidelity as newly captured ones, without requiring the developer to manually re-run or reconfigure anything. This re-evaluation MUST run as a blocking backfill completed as part of deploying the fix, before any usage view becomes available to open, so no view can be opened against stale, uncorrected historical data.
- **FR-011**: All summary, reasoning, and validation text remains subject to the existing secret/credential redaction behavior; improving readability MUST NOT surface previously redacted content.

### Key Entities

- **Usage Event** *(existing entity, refined)*: gains a plain-language, human-readable summary distinct from its raw input detail; its reasoning, validation, and subagent-type fields are corrected to reliably reflect what is actually present in the source session rather than defaulting to "not captured" / "not observed" / omitted.
- **Subagent Invocation** *(existing entity, refined)*: a Usage Event representing a delegation to a subagent; now guaranteed to appear in subagent views even when its specific type is undetermined, via a clearly labeled "unknown type" grouping.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can tell what an invocation did by reading only its summary, without opening raw parameters, for at least 95% of invocations in a typical session.
- **SC-002**: Zero invocations show a summary that is truncated mid-word or mid-structure in a way that obscures its meaning.
- **SC-003**: For sessions where the agent visibly stated its reasoning in the transcript, the reasoning column reflects that content for at least 95% of such invocations (down from effectively 0% observed today).
- **SC-004**: For sessions containing an observable validation follow-up in the transcript, the validation column reflects the detected outcome for at least 90% of such cases (down from effectively 0% observed today).
- **SC-005**: 100% of subagent (Task) delegations in an ingested session appear in the Subagents view, either under their specific type or an "unknown type" grouping.
- **SC-006**: After the fix is deployed, previously ingested sessions show corrected summaries, reasoning, validation, and subagent visibility without the developer needing to take any manual action.

## Assumptions

- This feature is a fidelity fix to the existing Tool & Subagent Usage Observability capability (see `001-tool-usage-observability`); it does not introduce new usage views, only corrects the accuracy and readability of data already specified for the existing ones.
- The underlying session transcripts already contain the reasoning, validation, and subagent information described here (per `001`'s assumptions); the problem being solved is that current extraction logic fails to surface information that is genuinely present, not that new instrumentation must be added to Claude Code itself.
- Source transcripts for previously ingested sessions remain available on local disk, so historical sessions can be re-evaluated under the corrected logic (FR-010) without needing the original live session to still be running.
- Redaction of known secret/credential patterns (from `001`) continues to apply unchanged to the new human-readable summary field, exactly as it already does to reasoning and raw input text.
- A small number of specific commands/tools may still not resolve to a fully natural-language description (e.g., an unusual or highly composite shell pipeline); in those cases a clearly formatted, readable rendering of the actual command is an acceptable fallback, so long as it is not raw truncated JSON.
- "Subagent tracing" in scope here means the subagent delegation itself (its type, task, and outcome) reliably appearing in the Subagents view — not extending drill-down to the subagent's own internal tool-call sequence, which is a separate, larger capability not requested here.
