import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverTranscripts } from "../../src/ingest/discover-transcripts.js";
import { readNewLines } from "../../src/ingest/incremental-reader.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "observe-ingest-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("discoverTranscripts", () => {
  it("returns an empty list when the root doesn't exist", () => {
    expect(discoverTranscripts(join(root, "missing"))).toEqual([]);
  });

  it("finds .jsonl files nested under project directories, ignoring other files", () => {
    const projectDir = join(root, "-Users-dev-project");
    mkdirSync(projectDir, { recursive: true });
    const transcriptPath = join(projectDir, "session-1.jsonl");
    writeFileSync(transcriptPath, '{"type":"user"}\n');
    writeFileSync(join(projectDir, "notes.txt"), "not a transcript");

    expect(discoverTranscripts(root)).toEqual([transcriptPath]);
  });
});

describe("readNewLines", () => {
  it("reads all complete lines from offset 0 on first read", () => {
    const filePath = join(root, "session.jsonl");
    writeFileSync(filePath, '{"a":1}\n{"a":2}\n');

    const result = readNewLines(filePath, 0);

    expect(result.lines).toEqual(['{"a":1}', '{"a":2}']);
    expect(result.newOffset).toBeGreaterThan(0);
  });

  it("on a re-run, only picks up newly appended lines", () => {
    const filePath = join(root, "session.jsonl");
    writeFileSync(filePath, '{"a":1}\n');
    const first = readNewLines(filePath, 0);
    expect(first.lines).toEqual(['{"a":1}']);

    appendFileSync(filePath, '{"a":2}\n{"a":3}\n');
    const second = readNewLines(filePath, first.newOffset);

    expect(second.lines).toEqual(['{"a":2}', '{"a":3}']);
    expect(second.newOffset).toBeGreaterThan(first.newOffset);
  });

  it("leaves a not-yet-newline-terminated trailing line for the next read", () => {
    const filePath = join(root, "session.jsonl");
    writeFileSync(filePath, '{"a":1}\n{"a":2}');

    const result = readNewLines(filePath, 0);

    expect(result.lines).toEqual(['{"a":1}']);

    appendFileSync(filePath, "\n");
    const second = readNewLines(filePath, result.newOffset);
    expect(second.lines).toEqual(['{"a":2}']);
  });

  it("returns no lines when nothing new has been appended", () => {
    const filePath = join(root, "session.jsonl");
    writeFileSync(filePath, '{"a":1}\n');
    const first = readNewLines(filePath, 0);

    const second = readNewLines(filePath, first.newOffset);
    expect(second.lines).toEqual([]);
    expect(second.newOffset).toBe(first.newOffset);
  });
});
