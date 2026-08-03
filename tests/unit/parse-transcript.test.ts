import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTranscriptLine } from "../../src/core/parse-transcript.js";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

function loadLines(fixtureFile: string): string[] {
  return readFileSync(join(FIXTURES_DIR, fixtureFile), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

describe("parseTranscriptLine", () => {
  it("parses assistant and user event lines with their content blocks intact", () => {
    const [assistantLine, userLine] = loadLines("tool-success.jsonl");
    const assistant = parseTranscriptLine(assistantLine);
    const user = parseTranscriptLine(userLine);

    expect(assistant?.type).toBe("assistant");
    expect(assistant?.sessionId).toBe("fixture-session-1");
    expect(assistant?.message.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "tool_use", name: "Read" })])
    );

    expect(user?.type).toBe("user");
    expect(user?.message.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "tool_result" })])
    );
  });

  it("parses a Task/subagent tool_use block", () => {
    const [assistantLine] = loadLines("subagent-task.jsonl");
    const assistant = parseTranscriptLine(assistantLine);
    const content = assistant?.message.content;
    expect(Array.isArray(content) && content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_use",
          name: "Task",
          input: expect.objectContaining({ subagent_type: "Explore" }),
        }),
      ])
    );
  });

  it("ignores every non-event line type, returning null", () => {
    const lines = loadLines("non-event-lines.jsonl");
    const results = lines.map(parseTranscriptLine);
    const nonEventResults = results.slice(0, 7);
    const lastResult = results[7];

    for (const result of nonEventResults) {
      expect(result).toBeNull();
    }
    expect(lastResult?.type).toBe("assistant");
  });

  it("returns null for a blank line", () => {
    expect(parseTranscriptLine("")).toBeNull();
    expect(parseTranscriptLine("   ")).toBeNull();
  });
});
