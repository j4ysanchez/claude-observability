import { existsSync } from "node:fs";
import type Database from "better-sqlite3";
import { byTool, type ToolCount } from "../core/summarize.js";
import type { Outcome } from "../core/types.js";
import { defaultTranscriptRoot } from "../ingest/discover-transcripts.js";
import { syncTranscripts } from "../ingest/sync.js";
import { countSessions, getLastIngestAt, getUsageEventsSince } from "../storage/repository.js";

export type RangeParam = "today" | "7d" | "30d" | "all";

const RANGE_VALUES: ReadonlySet<string> = new Set(["today", "7d", "30d", "all"]);

function isRangeParam(value: string | null): value is RangeParam {
  return value !== null && RANGE_VALUES.has(value);
}

/** Parses the `range` query param, defaulting to `today` when missing/invalid (FR-005). */
export function parseRange(value: string | null): RangeParam {
  return isRangeParam(value) ? value : "today";
}

/** The ISO timestamp cutoff for a range, or `null` for `all` (no lower bound). */
export function rangeSince(range: RangeParam, now: Date = new Date()): string | null {
  switch (range) {
    case "today": {
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      return start.toISOString();
    }
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    case "all":
      return null;
  }
}

export interface StatusResponse {
  readonly hasTranscriptSource: boolean;
  readonly transcriptRoot: string;
  readonly sessionCount: number;
  readonly lastIngestAt: string | null;
  readonly message: string;
}

export interface SummaryResponse {
  readonly range: RangeParam;
  readonly generatedAt: string;
  readonly byTool: ReadonlyArray<ToolCount>;
  readonly bySubagent: ReadonlyArray<{
    readonly subagentType: string;
    readonly count: number;
    readonly outcomes: Record<Outcome, number>;
  }>;
}

/**
 * GET /api/status (contracts/api.md): reports whether any data is
 * available at all, distinguishing "no transcript root" (telemetry not
 * enabled/no source) from "transcript root exists but zero sessions" with
 * a distinct human-readable `message` for each (FR-010).
 */
export function handleStatus(db: Database.Database, transcriptRoot?: string): StatusResponse {
  const root = transcriptRoot ?? defaultTranscriptRoot();
  const hasTranscriptSource = existsSync(root);

  syncTranscripts(db, transcriptRoot);

  const sessionCount = countSessions(db);
  const lastIngestAt = getLastIngestAt(db);

  let message: string;
  if (!hasTranscriptSource) {
    message =
      "No Claude Code transcript directory found. Telemetry may not be enabled on this machine.";
  } else if (sessionCount === 0) {
    message = "No Claude Code sessions found yet. Run Claude Code at least once, then reopen this dashboard.";
  } else {
    message = `Tracking ${sessionCount} session${sessionCount === 1 ? "" : "s"}.`;
  }

  return { hasTranscriptSource, transcriptRoot: root, sessionCount, lastIngestAt, message };
}

/**
 * GET /api/summary?range= (contracts/api.md): tool + subagent breakdown for
 * the range (FR-005, FR-006). `bySubagent` stays `[]` until User Story 3
 * populates it (research.md scope note in tasks.md T028).
 */
export function handleSummary(
  db: Database.Database,
  rangeParam: string | null,
  transcriptRoot?: string
): SummaryResponse {
  syncTranscripts(db, transcriptRoot);

  const range = parseRange(rangeParam);
  const since = rangeSince(range);
  const events = getUsageEventsSince(db, since);

  return {
    range,
    generatedAt: new Date().toISOString(),
    byTool: byTool(events),
    bySubagent: [],
  };
}
