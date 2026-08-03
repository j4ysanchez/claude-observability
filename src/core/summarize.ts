import type { UsageEvent } from "./types.js";

export interface ToolCount {
  readonly toolName: string;
  readonly count: number;
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
