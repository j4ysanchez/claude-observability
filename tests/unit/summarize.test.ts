import { describe, expect, it } from "vitest";
import { byTool } from "../../src/core/summarize.js";
import type { UsageEvent } from "../../src/core/types.js";

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    eventId: "sess-1:tool_1",
    sessionId: "sess-1",
    sequence: 1,
    timestamp: "2026-08-01T10:00:00.000Z",
    toolName: "Bash",
    isSubagent: false,
    subagentType: null,
    subagentTask: null,
    outcome: "succeeded",
    reasoning: null,
    inputSummary: null,
    projectPath: "/Users/dev/project",
    ...overrides,
  };
}

describe("byTool", () => {
  it("returns an empty array, not omitted/null/undefined, when there are no events (FR-010)", () => {
    expect(byTool([])).toEqual([]);
  });

  it("groups events by toolName with accurate counts", () => {
    const events = [
      makeEvent({ toolName: "Bash" }),
      makeEvent({ toolName: "Read" }),
      makeEvent({ toolName: "Bash" }),
      makeEvent({ toolName: "Read" }),
      makeEvent({ toolName: "Bash" }),
    ];

    expect(byTool(events)).toEqual([
      { toolName: "Bash", count: 3 },
      { toolName: "Read", count: 2 },
    ]);
  });

  it("counts every outcome the same way — outcome doesn't affect whether an invocation is counted", () => {
    const events = [
      makeEvent({ toolName: "Edit", outcome: "succeeded" }),
      makeEvent({ toolName: "Edit", outcome: "failed" }),
      makeEvent({ toolName: "Edit", outcome: "denied" }),
      makeEvent({ toolName: "Edit", outcome: "in_progress" }),
    ];

    expect(byTool(events)).toEqual([{ toolName: "Edit", count: 4 }]);
  });

  it("orders results by count descending, breaking ties alphabetically for a stable order", () => {
    const events = [
      makeEvent({ toolName: "Write" }),
      makeEvent({ toolName: "Edit" }),
      makeEvent({ toolName: "Bash" }),
      makeEvent({ toolName: "Bash" }),
    ];

    expect(byTool(events)).toEqual([
      { toolName: "Bash", count: 2 },
      { toolName: "Edit", count: 1 },
      { toolName: "Write", count: 1 },
    ]);
  });
});
