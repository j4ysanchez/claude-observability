import type {
  ContentBlock,
  RawTranscriptLine,
  ToolResultBlock,
  ToolUseBlock,
  UsageEvent,
  ValidationCheck,
} from "./types.js";
import { classifyOutcome } from "./classify-outcome.js";
import { detectValidation, extractReasoning, summarizeInput } from "./extract-context.js";
import { redact } from "./redact.js";

function contentBlocks(line: RawTranscriptLine): ReadonlyArray<ContentBlock> {
  const content = line.message.content;
  return typeof content === "string" ? [] : content;
}

interface SubagentFields {
  readonly subagentType: string | null;
  readonly subagentTask: string | null;
}

const NOT_A_SUBAGENT: SubagentFields = { subagentType: null, subagentTask: null };

/**
 * research.md §3 (FR-002/FR-003): a Task tool_use's own `input` already
 * carries everything needed to describe the delegation — `subagent_type`
 * and a `description`/`prompt` pair for the task it was given. `prompt` is
 * preferred as the captured "task" when present (the full instruction the
 * subagent received); `description` (a short label) is the fallback for a
 * Task call that omits it. Redacted before it becomes part of a UsageEvent,
 * same as reasoning/inputSummary (research.md §7). `null`/`null` for any
 * non-Task tool_use — `subagentType`/`subagentTask` are non-null iff
 * `isSubagent` (data-model.md validation rule).
 */
function extractSubagentFields(toolUse: ToolUseBlock): SubagentFields {
  if (toolUse.name !== "Task") {
    return NOT_A_SUBAGENT;
  }

  const subagentTypeInput = toolUse.input.subagent_type;
  const promptInput = toolUse.input.prompt;
  const descriptionInput = toolUse.input.description;

  const subagentType = typeof subagentTypeInput === "string" ? subagentTypeInput : null;
  const task =
    typeof promptInput === "string"
      ? promptInput
      : typeof descriptionInput === "string"
        ? descriptionInput
        : null;

  return { subagentType, subagentTask: task !== null ? redact(task) : null };
}

export interface BuildUsageEventsResult {
  readonly events: UsageEvent[];
  readonly validationChecks: ValidationCheck[];
}

/**
 * Builds UsageEvents (+ their ValidationChecks) from an ordered batch of
 * already-parsed transcript lines belonging to one session (research.md
 * §1-§6). Composes parse-transcript (already applied by the caller) ->
 * classify-outcome -> extract-context (reasoning/input/validation) into the
 * full UsageEvent shape. `subagentType`/`subagentTask` are populated from
 * the Task tool's own `input` when `isSubagent` (research.md §3, FR-002/
 * FR-003) — everything else free-text (`reasoning`, `inputSummary`, a
 * ValidationCheck's `checkedWhat`, and `subagentTask`) is routed through
 * redact() before it ever becomes part of these shapes.
 *
 * Each `tool_use` block is paired with the `tool_result` block (matching
 * `tool_use_id`) found anywhere else in the same batch; a `tool_use` with no
 * matching result yet in the batch is `in_progress` (research.md §2).
 * Reasoning is captured from content blocks preceding the `tool_use` within
 * the SAME assistant message; the validation-check heuristic scans forward
 * within the same batch. Only pairing/scanning within a single incremental
 * read batch is handled here — a `tool_use` whose result or follow-up check
 * lands in a *later* sync's batch is not retroactively re-paired/detected
 * (acceptable scope for this feature; see sync.ts).
 *
 * `startSequence` lets the caller continue numbering across multiple
 * incremental syncs of the same session (`sequence` is a session-wide
 * ordinal, not batch-relative).
 */
export function buildUsageEventsWithValidation(
  lines: readonly RawTranscriptLine[],
  startSequence = 0
): BuildUsageEventsResult {
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
  const validationChecks: ValidationCheck[] = [];
  let sequence = startSequence;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    if (line.type !== "assistant") {
      continue;
    }
    const blocks = contentBlocks(line);

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex]!;
      if (block.type !== "tool_use") {
        continue;
      }
      const toolUse = block as ToolUseBlock;
      sequence += 1;
      const toolResult = resultsByToolUseId.get(toolUse.id) ?? null;
      const eventId = `${line.sessionId}:${toolUse.id}`;
      const { subagentType, subagentTask } = extractSubagentFields(toolUse);

      events.push({
        eventId,
        sessionId: line.sessionId,
        sequence,
        timestamp: line.timestamp,
        toolName: toolUse.name,
        isSubagent: toolUse.name === "Task",
        subagentType,
        subagentTask,
        outcome: classifyOutcome(toolResult),
        reasoning: extractReasoning(blocks.slice(0, blockIndex)),
        inputSummary: summarizeInput(toolUse.input),
        projectPath: line.cwd ?? "",
      });

      const validation = detectValidation(lines, lineIndex, toolUse);
      validationChecks.push({ usageEventId: eventId, ...validation });
    }
  }

  return { events, validationChecks };
}

/**
 * Convenience wrapper over `buildUsageEventsWithValidation` for callers that
 * only need the UsageEvents themselves (e.g. unit tests, or `bySubagent`-
 * style aggregation) without their ValidationChecks.
 */
export function buildUsageEvents(
  lines: readonly RawTranscriptLine[],
  startSequence = 0
): UsageEvent[] {
  return buildUsageEventsWithValidation(lines, startSequence).events;
}
