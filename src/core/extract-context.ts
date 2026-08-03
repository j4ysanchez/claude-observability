import { redact } from "./redact.js";
import type {
  ContentBlock,
  RawTranscriptLine,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ValidationResult,
} from "./types.js";

function contentBlocks(line: RawTranscriptLine): ReadonlyArray<ContentBlock> {
  const content = line.message.content;
  return typeof content === "string" ? [] : content;
}

/**
 * research.md §4 (FR-012): walks backwards through the content blocks that
 * precede a `tool_use` within the SAME assistant message, returning the
 * nearest non-empty `text`/`thinking` block as the captured reasoning.
 * `null` ("not captured") when none exists in that message — reasoning is
 * never inferred from anything outside the immediately preceding blocks.
 */
export function extractReasoning(precedingBlocks: readonly ContentBlock[]): string | null {
  for (let i = precedingBlocks.length - 1; i >= 0; i--) {
    const block = precedingBlocks[i]!;
    if (block.type === "text") {
      const text = (block as TextBlock).text.trim();
      if (text.length > 0) {
        return redact(text);
      }
    } else if (block.type === "thinking") {
      const thinking = (block as ThinkingBlock).thinking.trim();
      if (thinking.length > 0) {
        return redact(thinking);
      }
    }
  }
  return null;
}

/**
 * research.md §5 (FR-013): serializes the whole `tool_use.input` object —
 * no tool-specific allowlist of "interesting" fields, so no tool type needs
 * special-casing — redacted before it becomes part of a UsageEvent.
 */
export function summarizeInput(input: Readonly<Record<string, unknown>>): string {
  return redact(JSON.stringify(input));
}

export interface ValidationOutcome {
  readonly checkedWhat: string;
  readonly result: ValidationResult;
}

// Tools with no natural "did it work" result to re-check (research.md §6) —
// a Read/Grep/etc. call has nothing further about itself to confirm.
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "NotebookRead",
  "LS",
  "TodoRead",
]);

const VERIFY_KEYWORDS =
  /\b(verify|verifying|verified|confirm|confirming|confirmed|re-?read|re-?check|recheck|double[- ]check|ensure|ensuring)\b/i;

const CORRECTION_KEYWORDS =
  /\b(wrong|didn't|did not|doesn't|does not|mismatch|incorrect|actually|error|fix|fixed|fixing)\b/i;

const MAX_FOLLOW_UP_TURNS = 2;

/**
 * The file path / command a tool acted on, used to match a later check
 * against the same target. `null` when the tool has no single identifiable
 * target (nothing to match a follow-up against).
 */
function targetOf(toolName: string, input: Readonly<Record<string, unknown>>): string | null {
  if (toolName === "Bash") {
    return typeof input.command === "string" ? input.command : null;
  }
  const filePath = input.file_path ?? input.path ?? input.notebook_path;
  return typeof filePath === "string" ? filePath : null;
}

/**
 * Scans up to one assistant turn after the check turn for a further
 * tool_use on the same target whose stated reasoning indicates a problem
 * was found and corrected (research.md §6's "mismatch_corrected" case).
 */
function findCorrection(
  lines: readonly RawTranscriptLine[],
  checkLineIndex: number,
  target: string
): boolean {
  let turnsScanned = 0;
  for (let i = checkLineIndex + 1; i < lines.length && turnsScanned < 1; i++) {
    const line = lines[i]!;
    if (line.type !== "assistant") {
      continue;
    }
    turnsScanned++;

    const blocks = contentBlocks(line);
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b]!;
      if (block.type !== "tool_use") {
        continue;
      }
      const followUp = block as ToolUseBlock;
      if (targetOf(followUp.name, followUp.input) !== target) {
        continue;
      }
      const reasoning = extractReasoning(blocks.slice(0, b));
      if (reasoning !== null && CORRECTION_KEYWORDS.test(reasoning)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * research.md §6 (FR-014/FR-016): the opportunistic, heuristic
 * validation-check detector. Operates on the same batch of transcript lines
 * build-usage-event.ts is already processing for a session — a check whose
 * follow-up lands in a *later* incremental sync's batch is not
 * retroactively detected (same scope limitation as tool_result pairing in
 * build-usage-event.ts).
 *
 * - A tool with no natural expected result to re-check (a read-only
 *   `Read`/`Grep`/etc., or a tool with no single identifiable target) ->
 *   `not_applicable`.
 * - A tool followed within `MAX_FOLLOW_UP_TURNS` assistant turns by a
 *   `tool_use` on the same target (file_path/command), preceded by
 *   reasoning that references verification -> `confirmed`, unless a further
 *   `tool_use` on that same target one turn later is preceded by reasoning
 *   indicating a problem was found and corrected -> `mismatch_corrected`.
 * - Otherwise -> `not_observed` (nothing was found; this is distinct from
 *   "nothing applies").
 */
export function detectValidation(
  lines: readonly RawTranscriptLine[],
  toolUseLineIndex: number,
  toolUse: ToolUseBlock
): ValidationOutcome {
  if (READ_ONLY_TOOLS.has(toolUse.name)) {
    return {
      checkedWhat: `${toolUse.name} has no natural result to re-check`,
      result: "not_applicable",
    };
  }

  const target = targetOf(toolUse.name, toolUse.input);
  if (target === null) {
    return {
      checkedWhat: `${toolUse.name} has no single identifiable target to re-check`,
      result: "not_applicable",
    };
  }

  let turnsScanned = 0;
  for (
    let i = toolUseLineIndex + 1;
    i < lines.length && turnsScanned < MAX_FOLLOW_UP_TURNS;
    i++
  ) {
    const line = lines[i]!;
    if (line.type !== "assistant") {
      continue;
    }
    turnsScanned++;

    const blocks = contentBlocks(line);
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b]!;
      if (block.type !== "tool_use") {
        continue;
      }
      const followUp = block as ToolUseBlock;
      if (targetOf(followUp.name, followUp.input) !== target) {
        continue;
      }

      const checkReasoning = extractReasoning(blocks.slice(0, b));
      if (checkReasoning === null || !VERIFY_KEYWORDS.test(checkReasoning)) {
        continue;
      }

      if (findCorrection(lines, i, target)) {
        return {
          checkedWhat: redact(
            `Re-checked ${target} after the ${toolUse.name}; found a mismatch and corrected it`
          ),
          result: "mismatch_corrected",
        };
      }

      return {
        checkedWhat: redact(`Re-checked ${target} after the ${toolUse.name}`),
        result: "confirmed",
      };
    }
  }

  return { checkedWhat: "No follow-up check observed", result: "not_observed" };
}
