import type { Outcome, UsageEvent } from "./types.js";

export type Granularity = "day" | "week";

export interface TrendBucket {
  readonly bucket: string;
  readonly toolCounts: Record<string, number>;
  readonly subagentCounts: Record<string, number>;
}

export interface ToolCount {
  readonly toolName: string;
  readonly count: number;
}

export interface SubagentCount {
  readonly subagentType: string;
  readonly count: number;
  readonly outcomes: Record<Outcome, number>;
}

/**
 * Groups UsageEvents by toolName into `{ toolName, count }[]`, per
 * data-model.md's UsageSummary.byTool. Always returns an array (empty when
 * `events` is empty), never omitted/null/undefined — this is what powers
 * FR-010's "clearly indicate no data" at the shape level. Sorted by count
 * descending (ties broken alphabetically by toolName) so the top tools by
 * usage are identifiable without further client-side sorting (SC-001).
 */
export function byTool(events: readonly UsageEvent[]): ToolCount[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.toolName, (counts.get(event.toolName) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName));
}

function emptyOutcomes(): Record<Outcome, number> {
  return { succeeded: 0, failed: 0, denied: 0, in_progress: 0 };
}

/**
 * Groups UsageEvents by subagentType into `{ subagentType, count, outcomes }[]`,
 * per data-model.md's UsageSummary.bySubagent (FR-006). Only events with
 * `isSubagent && subagentType !== null` contribute — a Task invocation whose
 * type couldn't be determined has nothing to group by. `outcomes` always
 * carries all four Outcome keys, zero-filled, per contracts/api.md's
 * example — never a partial record the client has to default itself.
 * Always returns an array (empty when there are no subagent events), same
 * "no data" contract as `byTool` (FR-010). Sorted by count descending (ties
 * broken alphabetically by subagentType), matching `byTool`'s ordering.
 */
export function bySubagent(events: readonly UsageEvent[]): SubagentCount[] {
  const counts = new Map<string, { count: number; outcomes: Record<Outcome, number> }>();

  for (const event of events) {
    if (!event.isSubagent || event.subagentType === null) {
      continue;
    }
    const entry = counts.get(event.subagentType) ?? { count: 0, outcomes: emptyOutcomes() };
    entry.count += 1;
    entry.outcomes[event.outcome] += 1;
    counts.set(event.subagentType, entry);
  }

  return Array.from(counts.entries())
    .map(([subagentType, { count, outcomes }]) => ({ subagentType, count, outcomes }))
    .sort((a, b) => b.count - a.count || a.subagentType.localeCompare(b.subagentType));
}

/** Truncates an ISO timestamp to the start (00:00:00.000 UTC) of its calendar day. */
function startOfUtcDay(iso: string): Date {
  const date = new Date(iso);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/** Truncates an ISO timestamp to the start (Monday, 00:00:00.000 UTC) of its ISO week. */
function startOfUtcWeek(iso: string): Date {
  const day = startOfUtcDay(iso);
  const weekday = day.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const daysSinceMonday = (weekday + 6) % 7; // Mon -> 0, Tue -> 1, ..., Sun -> 6
  day.setUTCDate(day.getUTCDate() - daysSinceMonday);
  return day;
}

function bucketStart(iso: string, granularity: Granularity): Date {
  return granularity === "day" ? startOfUtcDay(iso) : startOfUtcWeek(iso);
}

function bucketKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function emptyBucket(): { toolCounts: Record<string, number>; subagentCounts: Record<string, number> } {
  return { toolCounts: {}, subagentCounts: {} };
}

/**
 * Buckets UsageEvents into date-bucketed `toolCounts`/`subagentCounts` per
 * day or week across `[since, until]` inclusive (FR-007, data-model.md
 * UsageSummary.trend, contracts/api.md GET /api/trend). Always produces one
 * entry per bucket in the range in chronological order, including
 * zero-activity buckets with empty `{}` count objects — never omitted, same
 * "no data is still shown, not hidden" contract as `byTool`/`bySubagent`
 * (FR-010). `since`/`until` are ISO timestamps supplied by the caller (the
 * route layer resolves the actual range boundary and "now") — this function
 * takes no clock reading of its own, keeping it a pure function of its
 * inputs (Principle II).
 */
export function trend(
  events: readonly UsageEvent[],
  since: string,
  until: string,
  granularity: Granularity
): TrendBucket[] {
  const step = granularity === "day" ? 1 : 7;
  const lastBucketStart = bucketStart(until, granularity);

  const buckets = new Map<
    string,
    { toolCounts: Record<string, number>; subagentCounts: Record<string, number> }
  >();

  for (let cursor = bucketStart(since, granularity); cursor <= lastBucketStart; ) {
    buckets.set(bucketKey(cursor), emptyBucket());
    cursor.setUTCDate(cursor.getUTCDate() + step);
  }

  for (const event of events) {
    const key = bucketKey(bucketStart(event.timestamp, granularity));
    const entry = buckets.get(key);
    if (entry === undefined) {
      // Outside [since, until] (e.g. a caller-supplied event set wider than
      // the requested range) — not part of the requested trend window.
      continue;
    }
    entry.toolCounts[event.toolName] = (entry.toolCounts[event.toolName] ?? 0) + 1;
    if (event.isSubagent && event.subagentType !== null) {
      entry.subagentCounts[event.subagentType] = (entry.subagentCounts[event.subagentType] ?? 0) + 1;
    }
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, counts]) => ({ bucket, ...counts }));
}
