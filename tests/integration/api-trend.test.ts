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
  transcriptRoot = mkdtempSync(join(tmpdir(), "observe-trend-transcripts-"));
  dbDir = mkdtempSync(join(tmpdir(), "observe-trend-db-"));
  staticDir = mkdtempSync(join(tmpdir(), "observe-trend-static-"));
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

function toolUseLine(sessionId: string, uid: string, parentUid: string | null, timestamp: string, toolName: string, input: Record<string, unknown>) {
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

function toolResultLine(sessionId: string, uid: string, parentUid: string, timestamp: string, content: string) {
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
      content: [{ type: "tool_result", tool_use_id: `${parentUid}-tool`, content }],
    },
  };
}

/**
 * Writes one session with a Bash invocation on each of the given day
 * offsets (days ago, relative to "now"), skipping any offset in
 * `skipOffsets` entirely — so those days have zero recorded activity
 * (mirrors tests/fixtures/trend-multi-day.jsonl / T047's "8+ distinct days,
 * including at least one zero-activity day").
 */
function writeDailyActivity(sessionId: string, dayOffsets: readonly number[]): void {
  const lines: unknown[] = [];
  let seq = 0;
  for (const offset of dayOffsets) {
    const ts = new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString();
    const useUid = `${sessionId}-u${seq}`;
    const resultUid = `${sessionId}-r${seq}`;
    lines.push(toolUseLine(sessionId, useUid, seq === 0 ? null : `${sessionId}-r${seq - 1}`, ts, "Bash", { command: "npm test" }));
    lines.push(toolResultLine(sessionId, resultUid, useUid, ts, "ok"));
    seq += 1;
  }
  writeFileSync(join(projectDir(), `${sessionId}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

function utcDayKey(offsetDaysAgo: number): string {
  return new Date(Date.now() - offsetDaysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("GET /api/trend", () => {
  it("returns a bucket for every day in range, in chronological order, including a zero-activity day shown as empty rather than omitted (FR-007, quickstart Scenario 5)", async () => {
    // Activity on 7 of the last 8 days; day-offset 4 is deliberately skipped.
    const activeOffsets = [7, 6, 5, 3, 2, 1, 0];
    writeDailyActivity("sess-trend-1", activeOffsets);

    const res = await fetch(`${baseUrl}/api/trend?range=30d&granularity=day`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.range).toBe("30d");
    expect(body.granularity).toBe("day");
    expect(Array.isArray(body.buckets)).toBe(true);

    const byBucket = new Map<string, { toolCounts: Record<string, number> }>(
      body.buckets.map((b: { bucket: string; toolCounts: Record<string, number> }) => [b.bucket, b])
    );

    for (const offset of activeOffsets) {
      const key = utcDayKey(offset);
      expect(byBucket.get(key)?.toolCounts).toEqual({ Bash: 1 });
    }

    const zeroDayKey = utcDayKey(4);
    expect(byBucket.has(zeroDayKey)).toBe(true);
    expect(byBucket.get(zeroDayKey)?.toolCounts).toEqual({});

    // Buckets are chronologically ordered.
    const keys = body.buckets.map((b: { bucket: string }) => b.bucket);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });

  it("returns one well-formed empty bucket (not an empty array) when there is no data at all", async () => {
    const res = await fetch(`${baseUrl}/api/trend?range=today&granularity=day`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.buckets.length).toBeGreaterThan(0);
    for (const bucket of body.buckets) {
      expect(bucket.toolCounts).toEqual({});
      expect(bucket.subagentCounts).toEqual({});
    }
  });

  it("aggregates into week buckets when granularity=week", async () => {
    writeDailyActivity("sess-trend-week", [7, 6, 1, 0]);

    const res = await fetch(`${baseUrl}/api/trend?range=30d&granularity=week`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.granularity).toBe("week");

    const totalBashCount = body.buckets.reduce(
      (sum: number, b: { toolCounts: Record<string, number> }) => sum + (b.toolCounts.Bash ?? 0),
      0
    );
    expect(totalBashCount).toBe(4);
    // Weekly buckets collapse the 4 daily invocations into fewer rows than
    // one-per-day would produce.
    expect(body.buckets.length).toBeLessThan(30);
  });

  it("defaults to granularity=day when the param is missing/invalid", async () => {
    const res = await fetch(`${baseUrl}/api/trend?range=today`);
    const body = await res.json();

    expect(body.granularity).toBe("day");
  });
});
