import type Database from "better-sqlite3";
import { buildUsageEventsWithValidation } from "../core/build-usage-event.js";
import { parseTranscriptLine } from "../core/parse-transcript.js";
import type { RawTranscriptLine } from "../core/types.js";
import {
  getCursor,
  getMaxSequence,
  setCursor,
  upsertSession,
  upsertUsageEvent,
  upsertValidationCheck,
} from "../storage/repository.js";
import { discoverTranscripts } from "./discover-transcripts.js";
import { readNewLines } from "./incremental-reader.js";

/**
 * Pull-based, incremental sync (research.md §9): for each discovered
 * transcript, tail new lines via the stored byte-offset cursor, run them
 * through the core pipeline (parse -> build UsageEvents), upsert the
 * resulting session/rows, and advance the cursor. Idempotent and safe to
 * call on every API request — a transcript with no new bytes is a cheap
 * no-op.
 */
export function syncTranscripts(db: Database.Database, transcriptRoot?: string): void {
  const files =
    transcriptRoot === undefined ? discoverTranscripts() : discoverTranscripts(transcriptRoot);
  const syncedAt = new Date().toISOString();

  for (const filePath of files) {
    const offset = getCursor(db, filePath);
    const { lines: rawLines, newOffset } = readNewLines(filePath, offset);
    if (rawLines.length === 0) {
      continue;
    }

    const parsedLines = rawLines
      .map((line) => parseTranscriptLine(line))
      .filter((line): line is RawTranscriptLine => line !== null);

    if (parsedLines.length > 0) {
      const first = parsedLines[0]!;
      const last = parsedLines[parsedLines.length - 1]!;
      const sessionId = first.sessionId;

      upsertSession(db, {
        sessionId,
        projectPath: first.cwd ?? "",
        gitBranch: first.gitBranch ?? null,
        startedAt: first.timestamp,
        lastEventAt: last.timestamp,
        transcriptPath: filePath,
      });

      const startSequence = getMaxSequence(db, sessionId);
      const { events, validationChecks } = buildUsageEventsWithValidation(parsedLines, startSequence);
      for (const event of events) {
        upsertUsageEvent(db, event);
      }
      for (const validationCheck of validationChecks) {
        upsertValidationCheck(db, validationCheck);
      }
    }

    setCursor(db, filePath, newOffset, syncedAt);
  }
}
