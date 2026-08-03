import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardHandler, createHttpServer, listen } from "../../src/server/http-server.js";
import { openDatabase } from "../../src/storage/repository.js";

let transcriptRoot: string;
let dbDir: string;
let staticDir: string;
let db: Database.Database;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  transcriptRoot = mkdtempSync(join(tmpdir(), "observe-transcripts-"));
  dbDir = mkdtempSync(join(tmpdir(), "observe-db-"));
  staticDir = mkdtempSync(join(tmpdir(), "observe-static-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><html></html>");

  db = openDatabase(join(dbDir, "usage.db"));
  const handler = createDashboardHandler({ db, staticDir, transcriptRoot });
  server = createHttpServer(handler);
  baseUrl = `http://127.0.0.1:${await listen(server, 0)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(transcriptRoot, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
  rmSync(staticDir, { recursive: true, force: true });
});

function writeTranscript(sessionId: string, timestamp: string): void {
  const projectDir = join(transcriptRoot, "-Users-dev-project");
  mkdirSync(projectDir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: "assistant",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a1`,
      parentUuid: null,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Checking the config." },
          { type: "tool_use", id: `${sessionId}-tool-1`, name: "Read", input: { file_path: "config.json" } },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a2`,
      parentUuid: `${sessionId}-a1`,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `${sessionId}-tool-1`, content: "{}" }],
      },
    }),
  ];
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
}

/**
 * Writes one session delegating to two different subagent types with
 * different outcomes: an Explore Task that succeeded, a code-reviewer Task
 * that failed, and a second Explore Task left with no tool_result yet
 * (in_progress) — mirrors tests/fixtures/subagent-multi.jsonl (T040).
 */
function writeSubagentTranscript(sessionId: string, timestamp: string): void {
  const projectDir = join(transcriptRoot, "-Users-dev-project");
  mkdirSync(projectDir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: "assistant",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a1`,
      parentUuid: null,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Delegating a codebase search to an Explore subagent." },
          {
            type: "tool_use",
            id: `${sessionId}-explore-1`,
            name: "Task",
            input: {
              subagent_type: "Explore",
              description: "Find call sites of bar()",
              prompt: "Search the codebase for every call site of bar() and list the files.",
            },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a2`,
      parentUuid: `${sessionId}-a1`,
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: `${sessionId}-explore-1`, content: "Found 2 call sites." },
        ],
      },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a3`,
      parentUuid: `${sessionId}-a2`,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Delegating a code review to the code-reviewer subagent." },
          {
            type: "tool_use",
            id: `${sessionId}-review-1`,
            name: "Task",
            input: {
              subagent_type: "code-reviewer",
              description: "Review the pending diff",
              prompt: "Review the changes in src/core for correctness and style.",
            },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a4`,
      parentUuid: `${sessionId}-a3`,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: `${sessionId}-review-1`,
            is_error: true,
            content: "The subagent could not complete the review: timed out.",
          },
        ],
      },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a5`,
      parentUuid: `${sessionId}-a4`,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Delegating a second, still-running exploration." },
          {
            type: "tool_use",
            id: `${sessionId}-explore-2`,
            name: "Task",
            input: {
              subagent_type: "Explore",
              description: "Find additional usages",
              prompt: "Search for additional usages of bar() in the tests directory.",
            },
          },
        ],
      },
    }),
    // No matching tool_result for explore-2 -> in_progress.
  ];
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
}

describe("GET /api/status", () => {
  it("reports hasTranscriptSource true and zero sessions with a distinct 'no sessions' message on an empty root", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hasTranscriptSource).toBe(true);
    expect(body.transcriptRoot).toBe(transcriptRoot);
    expect(body.sessionCount).toBe(0);
    expect(body.lastIngestAt).toBeNull();
    expect(body.message).toMatch(/no.*sessions/i);
  });

  it("reports hasTranscriptSource false with a distinct 'no transcript source' message when the root doesn't exist", async () => {
    rmSync(transcriptRoot, { recursive: true, force: true });

    const res = await fetch(`${baseUrl}/api/status`);
    const body = await res.json();

    expect(body.hasTranscriptSource).toBe(false);
    expect(body.sessionCount).toBe(0);
    expect(body.message).not.toMatch(/no.*sessions/i);
  });

  it("reflects an ingested session after sync", async () => {
    writeTranscript("sess-a", new Date().toISOString());

    const res = await fetch(`${baseUrl}/api/status`);
    const body = await res.json();

    expect(body.sessionCount).toBe(1);
    expect(body.lastIngestAt).not.toBeNull();
    expect(body.message).toMatch(/1 session/i);
  });
});

describe("GET /api/summary", () => {
  it("returns empty byTool/bySubagent arrays (not omitted) when there is no data", async () => {
    const res = await fetch(`${baseUrl}/api/summary?range=today`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.range).toBe("today");
    expect(body.byTool).toEqual([]);
    expect(body.bySubagent).toEqual([]);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("reflects accurate per-tool counts from ingested transcripts, syncing first", async () => {
    writeTranscript("sess-b", new Date().toISOString());
    writeTranscript("sess-c", new Date().toISOString());

    const res = await fetch(`${baseUrl}/api/summary?range=today`);
    const body = await res.json();

    expect(body.byTool).toEqual([{ toolName: "Read", count: 2 }]);
  });

  it("excludes events outside the requested range", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    writeTranscript("sess-old", eightDaysAgo);

    const res = await fetch(`${baseUrl}/api/summary?range=7d`);
    const body = await res.json();

    expect(body.byTool).toEqual([]);
  });

  it("defaults to range=today when the range param is missing", async () => {
    const res = await fetch(`${baseUrl}/api/summary`);
    const body = await res.json();

    expect(body.range).toBe("today");
  });

  it("reflects an accurate per-subagentType breakdown with outcomes, incl. in_progress (User Story 3, quickstart Scenario 4)", async () => {
    writeSubagentTranscript("sess-subagents", new Date().toISOString());

    const res = await fetch(`${baseUrl}/api/summary?range=today`);
    const body = await res.json();

    expect(body.bySubagent).toEqual([
      {
        subagentType: "Explore",
        count: 2,
        outcomes: { succeeded: 1, failed: 0, denied: 0, in_progress: 1 },
      },
      {
        subagentType: "code-reviewer",
        count: 1,
        outcomes: { succeeded: 0, failed: 1, denied: 0, in_progress: 0 },
      },
    ]);
  });
});

describe("GET /api/events/:eventId — subagent drill-down (User Story 3)", () => {
  it("shows subagentType/subagentTask/outcome for a succeeded delegation", async () => {
    writeSubagentTranscript("sess-subagent-detail-1", new Date().toISOString());

    const list = await (
      await fetch(`${baseUrl}/api/events?sessionId=sess-subagent-detail-1`)
    ).json();
    const explored = list.events.find((e: { eventId: string }) =>
      e.eventId.endsWith("explore-1")
    );

    const res = await fetch(`${baseUrl}/api/events/${encodeURIComponent(explored.eventId)}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isSubagent).toBe(true);
    expect(body.subagentType).toBe("Explore");
    expect(body.subagentTask).toContain("bar()");
    expect(body.outcome).toBe("succeeded");
  });

  it("shows outcome: in_progress for a Task with no tool_result yet, never merged into succeeded/failed", async () => {
    writeSubagentTranscript("sess-subagent-detail-2", new Date().toISOString());

    const list = await (
      await fetch(`${baseUrl}/api/events?sessionId=sess-subagent-detail-2`)
    ).json();
    const stillRunning = list.events.find((e: { eventId: string }) =>
      e.eventId.endsWith("explore-2")
    );

    const res = await fetch(`${baseUrl}/api/events/${encodeURIComponent(stillRunning.eventId)}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.subagentType).toBe("Explore");
    expect(body.subagentTask).toContain("tests directory");
    expect(body.outcome).toBe("in_progress");
  });

  it("shows a failed subagent delegation distinctly from a succeeded one", async () => {
    writeSubagentTranscript("sess-subagent-detail-3", new Date().toISOString());

    const list = await (
      await fetch(`${baseUrl}/api/events?sessionId=sess-subagent-detail-3`)
    ).json();
    const reviewed = list.events.find((e: { eventId: string }) => e.eventId.endsWith("review-1"));

    const res = await fetch(`${baseUrl}/api/events/${encodeURIComponent(reviewed.eventId)}`);
    const body = await res.json();

    expect(body.subagentType).toBe("code-reviewer");
    expect(body.outcome).toBe("failed");
  });
});
