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
  transcriptRoot = mkdtempSync(join(tmpdir(), "observe-sessions-transcripts-"));
  dbDir = mkdtempSync(join(tmpdir(), "observe-sessions-db-"));
  staticDir = mkdtempSync(join(tmpdir(), "observe-sessions-static-"));
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

function projectDir(): string {
  const dir = join(transcriptRoot, "-Users-dev-project");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function toolUseLine(
  sessionId: string,
  uid: string,
  parentUid: string | null,
  timestamp: string,
  toolName: string,
  input: Record<string, unknown>
) {
  return {
    type: "assistant",
    sessionId,
    timestamp,
    cwd: "/Users/dev/project",
    gitBranch: "main",
    uuid: uid,
    parentUuid: parentUid,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: `Using ${toolName}.` },
        { type: "tool_use", id: `${uid}-tool`, name: toolName, input },
      ],
    },
  };
}

function toolResultLine(
  sessionId: string,
  uid: string,
  parentUid: string,
  timestamp: string,
  content: string,
  isError = false
) {
  return {
    type: "user",
    sessionId,
    timestamp,
    cwd: "/Users/dev/project",
    gitBranch: "main",
    uuid: uid,
    parentUuid: parentUid,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: `${parentUid}-tool`, content, ...(isError ? { is_error: true } : {}) },
      ],
    },
  };
}

interface Invocation {
  readonly timestamp: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly result: string;
  readonly isError?: boolean;
}

/** Writes a session transcript with a chronological chain of tool invocations. */
function writeSession(sessionId: string, invocations: readonly Invocation[]): void {
  const lines: unknown[] = [];
  let prevUid: string | null = null;
  invocations.forEach((inv, index) => {
    const useUid = `${sessionId}-u${index}`;
    const resultUid = `${sessionId}-r${index}`;
    lines.push(toolUseLine(sessionId, useUid, prevUid, inv.timestamp, inv.toolName, inv.input));
    lines.push(toolResultLine(sessionId, resultUid, useUid, inv.timestamp, inv.result, inv.isError));
    prevUid = resultUid;
  });
  writeFileSync(join(projectDir(), `${sessionId}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

const DENIAL_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (this is not an error, and is not a reflection of your own permissions, please continue without asking further)";

describe("GET /api/sessions", () => {
  it("lists sessions with eventCount and status derived from last-event freshness (research.md §8)", async () => {
    const now = new Date().toISOString();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    writeSession("sess-recent", [
      { timestamp: now, toolName: "Bash", input: { command: "npm test" }, result: "ok" },
      { timestamp: now, toolName: "Read", input: { file_path: "a.md" }, result: "# A" },
    ]);
    writeSession("sess-old", [
      { timestamp: tenMinutesAgo, toolName: "Bash", input: { command: "ls" }, result: "ok" },
    ]);

    const res = await fetch(`${baseUrl}/api/sessions?range=all`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.sessions)).toBe(true);

    const recent = body.sessions.find((s: { sessionId: string }) => s.sessionId === "sess-recent");
    const old = body.sessions.find((s: { sessionId: string }) => s.sessionId === "sess-old");

    expect(recent).toBeDefined();
    expect(recent.eventCount).toBe(2);
    expect(recent.status).toBe("in_progress");
    expect(recent.projectPath).toBe("/Users/dev/project");
    expect(typeof recent.startedAt).toBe("string");
    expect(typeof recent.lastEventAt).toBe("string");

    expect(old).toBeDefined();
    expect(old.eventCount).toBe(1);
    expect(old.status).toBe("concluded");
  });

  it("returns an empty sessions array (not an error) when there is no data", async () => {
    const res = await fetch(`${baseUrl}/api/sessions?range=today`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessions).toEqual([]);
  });
});

describe("GET /api/sessions/:sessionId/events", () => {
  it("returns the session's events in chronological sequence order, same row shape as GET /api/events", async () => {
    const base = Date.now();
    writeSession("sess-timeline", [
      {
        timestamp: new Date(base).toISOString(),
        toolName: "Bash",
        input: { command: "npm test" },
        result: "1 passing",
      },
      {
        timestamp: new Date(base + 1000).toISOString(),
        toolName: "Edit",
        input: { file_path: "src/foo.ts" },
        result: "The file has been updated.",
      },
      {
        timestamp: new Date(base + 2000).toISOString(),
        toolName: "Bash",
        input: { command: "rm -rf /" },
        result: DENIAL_MESSAGE,
      },
      {
        timestamp: new Date(base + 3000).toISOString(),
        toolName: "Bash",
        input: { command: "false" },
        result: "command failed",
        isError: true,
      },
    ]);

    const res = await fetch(`${baseUrl}/api/sessions/sess-timeline/events`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.events).toHaveLength(4);

    // Chronological (sequence ascending) order.
    const sequences = body.events.map((e: { sequence: number }) => e.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));

    expect(body.events.map((e: { toolName: string }) => e.toolName)).toEqual(["Bash", "Edit", "Bash", "Bash"]);
    expect(body.events.map((e: { outcome: string }) => e.outcome)).toEqual([
      "succeeded",
      "succeeded",
      "denied",
      "failed",
    ]);

    // Same row shape as GET /api/events (list rows, not full detail).
    for (const event of body.events) {
      expect(event).toHaveProperty("eventId");
      expect(event).toHaveProperty("sessionId", "sess-timeline");
      expect(event).toHaveProperty("hasReasoning");
      expect(event).toHaveProperty("hasValidation");
      expect(event.reasoning).toBeUndefined();
    }

    // Each event is openable into the Scenario 3 detail view.
    const detailRes = await fetch(`${baseUrl}/api/events/${encodeURIComponent(body.events[0].eventId)}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.sessionId).toBe("sess-timeline");
  });

  it("returns an empty events array for an unknown sessionId", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/does-not-exist/events`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
  });
});
