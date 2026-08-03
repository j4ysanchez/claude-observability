import type { RawTranscriptLine } from "./types.js";

/**
 * Parses one .jsonl transcript line. Only `user`/`assistant` lines carry
 * usage-event content (tool_use/tool_result/text/thinking blocks); every
 * other line type (`summary`, `ai-title`, `attachment`,
 * `file-history-snapshot`/`delta`, `queue-operation`, `last-prompt`, and any
 * other non-event type) is ignored (research.md §1).
 */
export function parseTranscriptLine(line: string): RawTranscriptLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as { type?: unknown };
  if (parsed.type !== "user" && parsed.type !== "assistant") {
    return null;
  }

  return parsed as unknown as RawTranscriptLine;
}
