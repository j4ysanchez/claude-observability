import type { Outcome, ToolResultBlock } from "./types.js";

const DENIAL_MESSAGE_PREFIX =
  "The user doesn't want to proceed with this tool use. The tool use was rejected";

function resultText(content: ToolResultBlock["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => (typeof part.text === "string" ? part.text : "")).join("");
}

/**
 * Classifies a tool invocation's outcome from its matching tool_result, per
 * research.md §2: no result yet -> in_progress; the fixed permission-denial
 * message -> denied (checked before is_error, since a denial is also
 * is_error: true in some transcript versions); is_error -> failed; else
 * succeeded.
 */
export function classifyOutcome(toolResult: ToolResultBlock | null): Outcome {
  if (toolResult === null) {
    return "in_progress";
  }

  const text = resultText(toolResult.content);
  if (text.startsWith(DENIAL_MESSAGE_PREFIX)) {
    return "denied";
  }

  if (toolResult.is_error === true) {
    return "failed";
  }

  return "succeeded";
}
