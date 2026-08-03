import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyOutcome } from "../../src/core/classify-outcome.js";
import type { ToolResultBlock } from "../../src/core/types.js";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

function loadToolResult(fixtureFile: string): ToolResultBlock {
  const lines = readFileSync(join(FIXTURES_DIR, fixtureFile), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const userLine = lines
    .map((line) => JSON.parse(line) as { type: string; message?: { content?: unknown[] } })
    .find((entry) => entry.type === "user");
  const block = (userLine?.message?.content ?? []).find(
    (b): b is ToolResultBlock => (b as { type?: string }).type === "tool_result"
  );
  if (!block) {
    throw new Error(`No tool_result block found in fixture ${fixtureFile}`);
  }
  return block;
}

describe("classifyOutcome", () => {
  it("returns succeeded for an ordinary successful tool_result", () => {
    expect(classifyOutcome(loadToolResult("tool-success.jsonl"))).toBe("succeeded");
  });

  it("returns failed for an is_error tool_result that isn't a denial", () => {
    expect(classifyOutcome(loadToolResult("tool-error.jsonl"))).toBe("failed");
  });

  it("returns denied for the fixed permission-rejection message", () => {
    expect(classifyOutcome(loadToolResult("permission-denied.jsonl"))).toBe("denied");
  });

  it("returns in_progress when there is no matching tool_result", () => {
    expect(classifyOutcome(null)).toBe("in_progress");
  });
});
