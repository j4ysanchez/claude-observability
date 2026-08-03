import type { Outcome, UsageEvent } from "./types.js";

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
