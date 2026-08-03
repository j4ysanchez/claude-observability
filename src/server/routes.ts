import { existsSync } from "node:fs";
import type Database from "better-sqlite3";
import { bySubagent, byTool, type SubagentCount, type ToolCount } from "../core/summarize.js";
import { defaultTranscriptRoot } from "../ingest/discover-transcripts.js";
import { syncTranscripts } from "../ingest/sync.js";
import {
  countSessions,
  getEventDetail,
  getEventsPage,
  getLastIngestAt,
  getUsageEventsSince,
  type EventDetail,
  type EventsPage,
} from "../storage/repository.js";

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
  readonly bySubagent: ReadonlyArray<SubagentCount>;
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
 * the range (FR-005, FR-006).
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
    bySubagent: bySubagent(events),
  };
}

export interface EventsListParams {
  readonly range: string | null;
  readonly tool: string | null;
  readonly subagentType: string | null;
  readonly sessionId: string | null;
  readonly page: string | null;
}

function parsePageParam(value: string | null): number {
  if (value === null) {
    return 1;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * GET /api/events?range=&tool=&subagentType=&sessionId=&page= (FR-008,
 * contracts/api.md): paginated UsageEvent list rows for drill-down, all
 * filters optional and combinable.
 */
export function handleEventsList(
  db: Database.Database,
  params: EventsListParams,
  transcriptRoot?: string
): EventsPage {
  syncTranscripts(db, transcriptRoot);

  const since = rangeSince(parseRange(params.range));
  return getEventsPage(db, {
    since,
    tool: params.tool,
    subagentType: params.subagentType,
    sessionId: params.sessionId,
    page: parsePageParam(params.page),
  });
}

/**
 * GET /api/events/:eventId (FR-015, contracts/api.md): full why/how/
 * validation detail for one invocation. `null` when the event doesn't
 * exist — the caller (http-server.ts) maps that to a 404.
 */
export function handleEventDetail(
  db: Database.Database,
  eventId: string,
  transcriptRoot?: string
): EventDetail | null {
  syncTranscripts(db, transcriptRoot);
  return getEventDetail(db, eventId);
}
