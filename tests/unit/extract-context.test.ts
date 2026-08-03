import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectValidation, extractReasoning, summarizeInput } from "../../src/core/extract-context.js";
import { parseTranscriptLine } from "../../src/core/parse-transcript.js";
import type { ContentBlock, RawTranscriptLine, ToolUseBlock } from "../../src/core/types.js";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

function loadLines(fixtureFile: string): RawTranscriptLine[] {
  return readFileSync(join(FIXTURES_DIR, fixtureFile), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseTranscriptLine(line))
    .filter((line): line is RawTranscriptLine => line !== null);
}

function contentBlocks(line: RawTranscriptLine): ReadonlyArray<ContentBlock> {
  const content = line.message.content;
  return typeof content === "string" ? [] : content;
}

function findToolUse(
  lines: readonly RawTranscriptLine[],
  toolUseId: string
): { lineIndex: number; toolUse: ToolUseBlock } {
  for (let i = 0; i < lines.length; i++) {
    for (const block of contentBlocks(lines[i]!)) {
      if (block.type === "tool_use" && (block as ToolUseBlock).id === toolUseId) {
        return { lineIndex: i, toolUse: block as ToolUseBlock };
      }
    }
  }
  throw new Error(`tool_use ${toolUseId} not found in fixture`);
}

describe("extractReasoning", () => {
  it("captures the nearest preceding non-empty text block as reasoning (FR-012)", () => {
    const lines = loadLines("tool-success.jsonl");
    const blocks = contentBlocks(lines[0]!);
    const toolUseIndex = blocks.findIndex((b) => b.type === "tool_use");

    expect(extractReasoning(blocks.slice(0, toolUseIndex))).toBe(
      "Let me check the current config file."
    );
  });

  it("returns null ('not captured') when there is no preceding text/thinking block, never fabricating one", () => {
    const lines = loadLines("no-reasoning.jsonl");
    const blocks = contentBlocks(lines[0]!);
    const toolUseIndex = blocks.findIndex((b) => b.type === "tool_use");

    expect(extractReasoning(blocks.slice(0, toolUseIndex))).toBeNull();
  });

  it("returns null for an empty list of preceding blocks", () => {
    expect(extractReasoning([])).toBeNull();
  });
});

describe("summarizeInput", () => {
  it("serializes the whole input object, not an allowlisted subset (FR-013)", () => {
    const input = { file_path: "a.ts", old_string: "x", new_string: "y" };
    expect(summarizeInput(input)).toBe(JSON.stringify(input));
  });

  it("redacts secret-shaped values before returning, never leaking raw secrets", () => {
    const summary = summarizeInput({
      command: "curl -H 'Authorization: Bearer sk-aaaaaaaaaaaaaaaaaaaa'",
    });

    expect(summary).not.toContain("sk-aaaaaaaaaaaaaaaaaaaa");
    expect(summary).toContain("[REDACTED]");
  });
});

describe("detectValidation", () => {
  it("marks a read-only tool as not_applicable regardless of follow-up activity (FR-014/FR-016)", () => {
    const lines = loadLines("validation-not-applicable.jsonl");
    const { lineIndex, toolUse } = findToolUse(lines, "tool_7");

    expect(detectValidation(lines, lineIndex, toolUse)).toEqual(
      expect.objectContaining({ result: "not_applicable" })
    );
  });

  it("marks an Edit confirmed by a later re-read of the same file as confirmed", () => {
    const lines = loadLines("validation-confirmed.jsonl");
    const { lineIndex, toolUse } = findToolUse(lines, "tool_8a");

    const outcome = detectValidation(lines, lineIndex, toolUse);
    expect(outcome.result).toBe("confirmed");
    expect(outcome.checkedWhat).toContain("redact.ts");
  });

  it("marks an Edit followed by a re-read revealing a problem and a corrective edit as mismatch_corrected", () => {
    const lines = loadLines("validation-mismatch.jsonl");
    const { lineIndex, toolUse } = findToolUse(lines, "tool_9a");

    expect(detectValidation(lines, lineIndex, toolUse).result).toBe("mismatch_corrected");
  });

  it("marks a mutating tool with no observed follow-up as not_observed, distinct from not_applicable", () => {
    const lines = loadLines("permission-denied.jsonl");
    const { lineIndex, toolUse } = findToolUse(lines, "tool_3");

    expect(detectValidation(lines, lineIndex, toolUse).result).toBe("not_observed");
  });
});
