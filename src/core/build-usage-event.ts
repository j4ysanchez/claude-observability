import type {
  ContentBlock,
  RawTranscriptLine,
  ToolResultBlock,
  ToolUseBlock,
  UsageEvent,
} from "./types.js";
import { classifyOutcome } from "./classify-outcome.js";

function contentBlocks(line: RawTranscriptLine): ReadonlyArray<ContentBlock> {
  const content = line.message.content;
  return typeof content === "string" ? [] : content;
}

/**
 * Builds UsageEvents from an ordered batch of already-parsed transcript
 * lines belonging to one session (research.md §1-§2). Composes
 * parse-transcript (already applied by the caller) -> classify-outcome ->
 * this shaping step into the minimal UsageEvent fields for User Story 1:
 * eventId/sessionId/sequence/timestamp/toolName/isSubagent/outcome/
 * projectPath. `reasoning`/`inputSummary`/`subagentType`/`subagentTask` are
 * left `null` for now (populated by extract-context.ts in User Story 2/3) —
 * nothing free-text is captured yet, so there is nothing for redact() to
 * act on at this stage; those fields will be routed through redact() when
 * they're populated.
 *
 * Each `tool_use` block is paired with the `tool_result` block (matching
 * `tool_use_id`) found anywhere else in the same batch; a `tool_use` with no
 * matching result yet in the batch is `in_progress` (research.md §2). Only
 * the pairing within a single incremental read batch is handled here — a
 * `tool_use` whose result lands in a *later* sync's batch stays
 * `in_progress` until re-observed together (acceptable for User Story 1's
 * scope; see sync.ts).
 *
 * `startSequence` lets the caller continue numbering across multiple
 * incremental syncs of the same session (`sequence` is a session-wide
 * ordinal, not batch-relative).
 */
export function buildUsageEvents(
  lines: readonly RawTranscriptLine[],
  startSequence = 0
): UsageEvent[] {
  const resultsByToolUseId = new Map<string, ToolResultBlock>();
  for (const line of lines) {
    if (line.type !== "user") {
      continue;
    }
    for (const block of contentBlocks(line)) {
      if (block.type === "tool_result") {
        const toolResult = block as ToolResultBlock;
        resultsByToolUseId.set(toolResult.tool_use_id, toolResult);
      }
    }
  }

  const events: UsageEvent[] = [];
  let sequence = startSequence;

  for (const line of lines) {
    if (line.type !== "assistant") {
      continue;
    }
    for (const block of contentBlocks(line)) {
      if (block.type !== "tool_use") {
        continue;
      }
      const toolUse = block as ToolUseBlock;
      sequence += 1;
      const toolResult = resultsByToolUseId.get(toolUse.id) ?? null;

      events.push({
        eventId: `${line.sessionId}:${toolUse.id}`,
        sessionId: line.sessionId,
        sequence,
        timestamp: line.timestamp,
        toolName: toolUse.name,
        isSubagent: toolUse.name === "Task",
        subagentType: null,
        subagentTask: null,
        outcome: classifyOutcome(toolResult),
        reasoning: null,
        inputSummary: null,
        projectPath: line.cwd ?? "",
      });
    }
  }

  return events;
}
