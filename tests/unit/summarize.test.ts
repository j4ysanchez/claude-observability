import { describe, expect, it } from "vitest";
import { bySubagent, byTool } from "../../src/core/summarize.js";
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

function makeSubagentEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return makeEvent({
    toolName: "Task",
    isSubagent: true,
    subagentType: "Explore",
    subagentTask: "Find call sites of foo()",
    ...overrides,
  });
}

describe("bySubagent", () => {
  it("returns an empty array, not omitted/null/undefined, when there are no events (FR-010)", () => {
    expect(bySubagent([])).toEqual([]);
  });

  it("ignores non-subagent events entirely", () => {
    const events = [makeEvent({ toolName: "Bash" }), makeEvent({ toolName: "Read" })];

    expect(bySubagent(events)).toEqual([]);
  });

  it("groups by subagentType with an accurate count", () => {
    const events = [
      makeSubagentEvent({ eventId: "sess-1:tool_1", subagentType: "Explore" }),
      makeSubagentEvent({ eventId: "sess-1:tool_2", subagentType: "code-reviewer" }),
      makeSubagentEvent({ eventId: "sess-1:tool_3", subagentType: "Explore" }),
    ];

    expect(bySubagent(events)).toEqual([
      {
        subagentType: "Explore",
        count: 2,
        outcomes: { succeeded: 2, failed: 0, denied: 0, in_progress: 0 },
      },
      {
        subagentType: "code-reviewer",
        count: 1,
        outcomes: { succeeded: 1, failed: 0, denied: 0, in_progress: 0 },
      },
    ]);
  });

  it("breaks down outcomes across all four states, including in_progress (FR-006, User Story 3)", () => {
    const events = [
      makeSubagentEvent({ eventId: "sess-1:tool_1", outcome: "succeeded" }),
      makeSubagentEvent({ eventId: "sess-1:tool_2", outcome: "failed" }),
      makeSubagentEvent({ eventId: "sess-1:tool_3", outcome: "denied" }),
      makeSubagentEvent({ eventId: "sess-1:tool_4", outcome: "in_progress" }),
      makeSubagentEvent({ eventId: "sess-1:tool_5", outcome: "in_progress" }),
    ];

    expect(bySubagent(events)).toEqual([
      {
        subagentType: "Explore",
        count: 5,
        outcomes: { succeeded: 1, failed: 1, denied: 1, in_progress: 2 },
      },
    ]);
  });

  it("orders results by count descending, breaking ties alphabetically for a stable order", () => {
    const events = [
      makeSubagentEvent({ eventId: "sess-1:tool_1", subagentType: "Write-heavy" }),
      makeSubagentEvent({ eventId: "sess-1:tool_2", subagentType: "Explore" }),
      makeSubagentEvent({ eventId: "sess-1:tool_3", subagentType: "code-reviewer" }),
      makeSubagentEvent({ eventId: "sess-1:tool_4", subagentType: "code-reviewer" }),
    ];

    expect(bySubagent(events).map((row) => row.subagentType)).toEqual([
      "code-reviewer",
      "Explore",
      "Write-heavy",
    ]);
  });

  it("ignores a Task event whose subagentType could not be determined", () => {
    const events = [makeSubagentEvent({ subagentType: null })];

    expect(bySubagent(events)).toEqual([]);
  });
});
