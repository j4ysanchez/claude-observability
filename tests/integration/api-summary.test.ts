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
});
