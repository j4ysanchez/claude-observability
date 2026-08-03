import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCursor, getSession, openDatabase, setCursor, upsertSession } from "../../src/storage/repository.js";
import type { Session } from "../../src/core/types.js";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "observe-storage-"));
  db = openDatabase(join(dir, "usage.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("openDatabase", () => {
  it("creates all tables from schema.ts", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining(["sessions", "usage_events", "validation_checks", "ingest_cursors"])
    );
  });
});

describe("session repository functions", () => {
  const session: Session = {
    sessionId: "sess-1",
    projectPath: "/Users/dev/project",
    gitBranch: "main",
    startedAt: "2026-08-01T10:00:00.000Z",
    lastEventAt: "2026-08-01T10:00:01.000Z",
    transcriptPath: "/Users/dev/.claude/projects/x/sess-1.jsonl",
  };

  it("returns null for a session that doesn't exist", () => {
    expect(getSession(db, "missing")).toBeNull();
  });

  it("round-trips a session through upsert and get", () => {
    upsertSession(db, session);
    expect(getSession(db, "sess-1")).toEqual(session);
  });

  it("updates last_event_at on a repeat upsert (idempotent re-ingest)", () => {
    upsertSession(db, session);
    upsertSession(db, { ...session, lastEventAt: "2026-08-01T10:05:00.000Z" });

    const result = getSession(db, "sess-1");
    expect(result?.lastEventAt).toBe("2026-08-01T10:05:00.000Z");
    expect(result?.startedAt).toBe(session.startedAt);
  });
});

describe("ingest cursor repository functions", () => {
  const transcriptPath = "/Users/dev/.claude/projects/x/sess-1.jsonl";

  it("defaults to offset 0 for an untracked transcript", () => {
    expect(getCursor(db, transcriptPath)).toBe(0);
  });

  it("round-trips a cursor through set and get", () => {
    setCursor(db, transcriptPath, 1024, "2026-08-01T10:00:05.000Z");
    expect(getCursor(db, transcriptPath)).toBe(1024);
  });

  it("advances the cursor on a repeat set", () => {
    setCursor(db, transcriptPath, 1024, "2026-08-01T10:00:05.000Z");
    setCursor(db, transcriptPath, 2048, "2026-08-01T10:01:00.000Z");
    expect(getCursor(db, transcriptPath)).toBe(2048);
  });
});
