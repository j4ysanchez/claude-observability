import { describe, expect, it } from "vitest";
import { bySubagent, byTool, trend } from "../../src/core/summarize.js";
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

describe("trend", () => {
  // 2026-07-27 is a Monday and 2026-08-03 (the next Monday) is exactly one
  // week later, so this range spans 8 distinct calendar days and crosses
  // exactly one ISO week boundary (07-27..08-02, then 08-03 alone) — mirrors
  // tests/fixtures/trend-multi-day.jsonl (T047), including a zero-activity
  // day (2026-07-30, a Thursday, has no events at all).
  const since = "2026-07-27T00:00:00.000Z";
  const until = "2026-08-03T20:00:00.000Z";

  const multiDayEvents: UsageEvent[] = [
    makeEvent({ eventId: "e1", toolName: "Bash", timestamp: "2026-07-27T10:00:00.000Z" }),
    makeEvent({ eventId: "e2", toolName: "Read", timestamp: "2026-07-27T11:00:00.000Z" }),
    makeEvent({ eventId: "e3", toolName: "Bash", timestamp: "2026-07-28T09:30:00.000Z" }),
    makeSubagentEvent({
      eventId: "e4",
      subagentType: "Explore",
      timestamp: "2026-07-29T14:00:00.000Z",
    }),
    // 2026-07-30: no events (zero-activity day).
    makeEvent({ eventId: "e5", toolName: "Edit", timestamp: "2026-07-31T08:15:00.000Z" }),
    makeEvent({
      eventId: "e6",
      toolName: "Bash",
      outcome: "failed",
      timestamp: "2026-08-01T16:00:00.000Z",
    }),
    makeSubagentEvent({
      eventId: "e7",
      subagentType: "code-reviewer",
      timestamp: "2026-08-01T16:05:00.000Z",
    }),
    makeEvent({ eventId: "e8", toolName: "Read", timestamp: "2026-08-02T12:00:00.000Z" }),
    makeEvent({ eventId: "e9", toolName: "Bash", timestamp: "2026-08-03T09:00:00.000Z" }),
  ];

  it("returns one bucket per day across the range, in chronological order, with the zero-activity day present as an empty bucket rather than omitted (FR-007)", () => {
    expect(trend(multiDayEvents, since, until, "day")).toEqual([
      { bucket: "2026-07-27", toolCounts: { Bash: 1, Read: 1 }, subagentCounts: {} },
      { bucket: "2026-07-28", toolCounts: { Bash: 1 }, subagentCounts: {} },
      { bucket: "2026-07-29", toolCounts: { Task: 1 }, subagentCounts: { Explore: 1 } },
      { bucket: "2026-07-30", toolCounts: {}, subagentCounts: {} },
      { bucket: "2026-07-31", toolCounts: { Edit: 1 }, subagentCounts: {} },
      {
        bucket: "2026-08-01",
        toolCounts: { Bash: 1, Task: 1 },
        subagentCounts: { "code-reviewer": 1 },
      },
      { bucket: "2026-08-02", toolCounts: { Read: 1 }, subagentCounts: {} },
      { bucket: "2026-08-03", toolCounts: { Bash: 1 }, subagentCounts: {} },
    ]);
  });

  it("returns one bucket per week, keyed by the Monday the week starts on, aggregating every day in that week (FR-007)", () => {
    expect(trend(multiDayEvents, since, until, "week")).toEqual([
      {
        bucket: "2026-07-27",
        toolCounts: { Bash: 3, Read: 2, Task: 2, Edit: 1 },
        subagentCounts: { Explore: 1, "code-reviewer": 1 },
      },
      { bucket: "2026-08-03", toolCounts: { Bash: 1 }, subagentCounts: {} },
    ]);
  });

  it("returns a single zero-activity bucket, not an empty array, when there is no data at all for the range (FR-010-style 'always shown as zero')", () => {
    expect(trend([], "2026-08-03T00:00:00.000Z", "2026-08-03T20:00:00.000Z", "day")).toEqual([
      { bucket: "2026-08-03", toolCounts: {}, subagentCounts: {} },
    ]);
  });

  it("ignores events outside [since, until]", () => {
    const events = [
      makeEvent({ eventId: "before", toolName: "Bash", timestamp: "2026-07-01T00:00:00.000Z" }),
      makeEvent({ eventId: "after", toolName: "Bash", timestamp: "2026-09-01T00:00:00.000Z" }),
    ];

    for (const bucket of trend(events, since, until, "day")) {
      expect(bucket.toolCounts).toEqual({});
    }
  });
});
