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
  transcriptRoot = mkdtempSync(join(tmpdir(), "observe-events-transcripts-"));
  dbDir = mkdtempSync(join(tmpdir(), "observe-events-db-"));
  staticDir = mkdtempSync(join(tmpdir(), "observe-events-static-"));
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

function writeLines(sessionId: string, lines: readonly unknown[]): void {
  writeFileSync(
    join(projectDir(), `${sessionId}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`
  );
}

/** An Edit with stated reasoning, confirmed by a later re-read of the same file. */
function writeEditConfirmedByRead(sessionId: string, timestamp: string): void {
  writeLines(sessionId, [
    {
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
          { type: "text", text: "Updating the redact regex to cover sk- tokens." },
          {
            type: "tool_use",
            id: `${sessionId}-edit`,
            name: "Edit",
            input: { file_path: "src/core/redact.ts", old_string: "OLD", new_string: "NEW" },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a2`,
      parentUuid: `${sessionId}-a1`,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `${sessionId}-edit`, content: "The file has been updated." }],
      },
    },
    {
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
          { type: "text", text: "Let me verify the edit by re-reading the file." },
          { type: "tool_use", id: `${sessionId}-read`, name: "Read", input: { file_path: "src/core/redact.ts" } },
        ],
      },
    },
    {
      type: "user",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a4`,
      parentUuid: `${sessionId}-a3`,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `${sessionId}-read`, content: "NEW" }],
      },
    },
  ]);
}

/** A read-only tool_use with no preceding reasoning text. */
function writeReadOnlyNoReasoning(sessionId: string, timestamp: string): void {
  writeLines(sessionId, [
    {
      type: "assistant",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a1`,
      parentUuid: null,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: `${sessionId}-read`, name: "Read", input: { file_path: "notes.md" } }],
      },
    },
    {
      type: "user",
      sessionId,
      timestamp,
      cwd: "/Users/dev/project",
      gitBranch: "main",
      uuid: `${sessionId}-a2`,
      parentUuid: `${sessionId}-a1`,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `${sessionId}-read`, content: "# Notes" }],
      },
    },
  ]);
}

describe("GET /api/events", () => {
  it("returns paginated rows with hasReasoning/hasValidation flags, not full text (contracts/api.md)", async () => {
    writeEditConfirmedByRead("sess-events-1", new Date().toISOString());

    const res = await fetch(`${baseUrl}/api/events?range=today`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.total).toBe(2);
    expect(body.events).toHaveLength(2);

    const editRow = body.events.find((e: { toolName: string }) => e.toolName === "Edit");
    expect(editRow.hasReasoning).toBe(true);
    expect(editRow.hasValidation).toBe(true);
    expect(editRow.reasoning).toBeUndefined();
    expect(editRow.inputSummary).toBeUndefined();
    expect(editRow.inputPreview).toContain("redact.ts");
  });

  it("truncates inputPreview to 80 characters for a long input, unlike the detail endpoint's full inputSummary", async () => {
    const longString = "x".repeat(500);
    writeLines("sess-events-long-input", [
      {
        type: "assistant",
        sessionId: "sess-events-long-input",
        timestamp: new Date().toISOString(),
        cwd: "/Users/dev/project",
        gitBranch: "main",
        uuid: "sess-events-long-input-a1",
        parentUuid: null,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "sess-events-long-input-write",
              name: "Write",
              input: { file_path: "notes.md", content: longString },
            },
          ],
        },
      },
      {
        type: "user",
        sessionId: "sess-events-long-input",
        timestamp: new Date().toISOString(),
        cwd: "/Users/dev/project",
        gitBranch: "main",
        uuid: "sess-events-long-input-a2",
        parentUuid: "sess-events-long-input-a1",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "sess-events-long-input-write", content: "File written." },
          ],
        },
      },
    ]);

    const res = await fetch(`${baseUrl}/api/events?sessionId=sess-events-long-input`);
    const body = await res.json();

    expect(body.events).toHaveLength(1);
    expect(body.events[0].inputPreview.length).toBe(81);
    expect(body.events[0].inputPreview.endsWith("…")).toBe(true);
  });

  it("filters by tool name", async () => {
    writeEditConfirmedByRead("sess-events-2", new Date().toISOString());

    const res = await fetch(`${baseUrl}/api/events?range=today&tool=Read`);
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].toolName).toBe("Read");
  });

  it("filters by sessionId and sorts by sequence ascending (User Story 5 session drill-down)", async () => {
    writeEditConfirmedByRead("sess-events-3", new Date().toISOString());

    const res = await fetch(`${baseUrl}/api/events?sessionId=sess-events-3`);
    const body = await res.json();

    expect(body.events.map((e: { toolName: string }) => e.toolName)).toEqual(["Edit", "Read"]);
    expect(body.events[0].sequence).toBeLessThan(body.events[1].sequence);
  });

  it("returns an empty page (not an error) when there is no data", async () => {
    const res = await fetch(`${baseUrl}/api/events?range=today`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.events).toEqual([]);
  });
});

describe("GET /api/events/:eventId", () => {
  it("returns full detail with non-null reasoning and a confirmed validation", async () => {
    writeEditConfirmedByRead("sess-events-4", new Date().toISOString());

    const list = await (await fetch(`${baseUrl}/api/events?sessionId=sess-events-4`)).json();
    const editRow = list.events.find((e: { toolName: string }) => e.toolName === "Edit");

    const res = await fetch(`${baseUrl}/api/events/${encodeURIComponent(editRow.eventId)}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.eventId).toBe(editRow.eventId);
    expect(body.reasoning).toBe("Updating the redact regex to cover sk- tokens.");
    expect(body.inputSummary).toContain("redact.ts");
    expect(body.validation).toEqual({
      checkedWhat: expect.any(String),
      result: "confirmed",
    });
  });

  it("returns reasoning: null and validation.result: not_applicable for a read-only tool with no preceding text (FR-016)", async () => {
    writeReadOnlyNoReasoning("sess-events-5", new Date().toISOString());

    const list = await (await fetch(`${baseUrl}/api/events?sessionId=sess-events-5`)).json();
    const readRow = list.events[0];

    const res = await fetch(`${baseUrl}/api/events/${encodeURIComponent(readRow.eventId)}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reasoning).toBeNull();
    expect(body.validation).not.toBeNull();
    expect(body.validation.result).toBe("not_applicable");
  });

  it("returns 404 for an unknown eventId", async () => {
    const res = await fetch(`${baseUrl}/api/events/does-not-exist`);
    expect(res.status).toBe(404);
  });
});
