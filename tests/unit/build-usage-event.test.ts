import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildUsageEvents } from "../../src/core/build-usage-event.js";
import { parseTranscriptLine } from "../../src/core/parse-transcript.js";
import type { RawTranscriptLine } from "../../src/core/types.js";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

function loadLines(fixtureFile: string): RawTranscriptLine[] {
  return readFileSync(join(FIXTURES_DIR, fixtureFile), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseTranscriptLine(line))
    .filter((line): line is RawTranscriptLine => line !== null);
}

describe("buildUsageEvents", () => {
  it("builds a succeeded UsageEvent with the minimal US1 fields from a paired tool_use/tool_result", () => {
    const [event] = buildUsageEvents(loadLines("tool-success.jsonl"));

    expect(event).toBeDefined();
    expect(event.eventId).toBe("fixture-session-1:tool_1");
    expect(event.sessionId).toBe("fixture-session-1");
    expect(event.sequence).toBe(1);
    expect(event.timestamp).toBe("2026-08-01T10:00:00.000Z");
    expect(event.toolName).toBe("Read");
    expect(event.isSubagent).toBe(false);
    expect(event.outcome).toBe("succeeded");
    expect(event.projectPath).toBe("/Users/dev/project");
  });

  it("marks a Task tool_use as a subagent invocation", () => {
    const [event] = buildUsageEvents(loadLines("subagent-task.jsonl"));

    expect(event.toolName).toBe("Task");
    expect(event.isSubagent).toBe(true);
  });

  it("classifies failed and denied outcomes distinctly, never merged (FR-009)", () => {
    expect(buildUsageEvents(loadLines("tool-error.jsonl"))[0].outcome).toBe("failed");
    expect(buildUsageEvents(loadLines("permission-denied.jsonl"))[0].outcome).toBe("denied");
  });

  it("marks a tool_use with no matching tool_result yet in the batch as in_progress", () => {
    const assistantLineOnly = loadLines("subagent-task.jsonl").filter(
      (line) => line.type === "assistant"
    );

    expect(buildUsageEvents(assistantLineOnly)[0].outcome).toBe("in_progress");
  });

  it("leaves reasoning/inputSummary/subagentType/subagentTask null for now (US2/US3 not yet built), never fabricating or leaking raw input text", () => {
    const [event] = buildUsageEvents(loadLines("tool-success.jsonl"));

    expect(event.reasoning).toBeNull();
    expect(event.inputSummary).toBeNull();
    expect(event.subagentType).toBeNull();
    expect(event.subagentTask).toBeNull();
  });

  it("continues sequence numbering from a supplied startSequence across syncs", () => {
    const [event] = buildUsageEvents(loadLines("tool-success.jsonl"), 5);

    expect(event.sequence).toBe(6);
  });

  it("only emits events for real tool_use blocks — non-event line types are already filtered by parse-transcript upstream", () => {
    const events = buildUsageEvents(loadLines("non-event-lines.jsonl"));

    expect(events).toHaveLength(1);
    expect(events[0].toolName).toBe("Read");
    expect(events[0].outcome).toBe("in_progress");
  });

  it("returns an empty array for no lines", () => {
    expect(buildUsageEvents([])).toEqual([]);
  });
});
