// Vanilla-JS dashboard frontend (no build step, no framework) — fetches the
// JSON API in contracts/api.md and renders it with plain DOM calls.

// `view` tracks which of the four sections (breakdown/subagent/events/detail)
// is showing; `eventsFilter` is remembered so "Back to invocations" from the
// detail panel can re-render the same filtered list without re-prompting.
// `eventsReturnView` remembers which breakdown tab ("breakdown" or
// "subagent") opened the current event list, so "Back to breakdown" returns
// to the tab the user actually came from (User Story 3).
const state = {
  range: "today",
  view: "breakdown",
  eventsFilter: null,
  eventsReturnView: "breakdown",
  trendGranularity: "day",
};
const OUTCOMES = ["succeeded", "failed", "denied", "in_progress"];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`);
  }
  return res.json();
}

function renderStatusMessage(message) {
  const el = document.getElementById("status-message");
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

function outcomeBadge(outcome) {
  const badge = document.createElement("span");
  badge.className = `badge badge-${outcome}`;
  badge.textContent = outcome.replace("_", " ");
  return badge;
}

function showView(view) {
  document.getElementById("tool-breakdown").hidden = view !== "breakdown";
  document.getElementById("subagent-breakdown").hidden = view !== "subagent";
  document.getElementById("trend-view").hidden = view !== "trend";
  document.getElementById("event-list").hidden = view !== "events";
  document.getElementById("event-detail").hidden = view !== "detail";
  state.view = view;
}

function setActiveTab(view) {
  for (const btn of document.querySelectorAll(".tab-btn")) {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  }
}

// Renders the per-tool breakdown table, or the "no data" message in its
// place instead of an empty/misleading table (FR-010). Each row opens the
// filtered event list for that tool (User Story 2 drill-down).
function renderToolTable(byTool) {
  const table = document.getElementById("tool-table");
  const tbody = document.getElementById("tool-table-body");
  const noData = document.getElementById("no-data-message");

  tbody.replaceChildren();

  if (byTool.length === 0) {
    table.hidden = true;
    noData.hidden = false;
    return;
  }

  table.hidden = false;
  noData.hidden = true;

  for (const row of byTool) {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.tabIndex = 0;

    const toolCell = document.createElement("td");
    toolCell.textContent = row.toolName;

    const countCell = document.createElement("td");
    countCell.textContent = String(row.count);

    tr.append(toolCell, countCell);
    tr.addEventListener("click", () => {
      state.eventsReturnView = "breakdown";
      openEventsView({ tool: row.toolName }).catch(handleRefreshError);
    });
    tbody.append(tr);
  }
}

// Renders the per-subagentType breakdown table — count plus an outcome
// breakdown per type (User Story 3, FR-006), or the "no data" message in its
// place (same FR-010 contract as the tool breakdown). Each row opens the
// filtered event list for that subagent type; drilling into an invocation
// from there reuses the same US2 detail view (openEventDetail below), now
// also showing the subagent's task and outcome.
function renderSubagentTable(bySubagent) {
  const table = document.getElementById("subagent-table");
  const tbody = document.getElementById("subagent-table-body");
  const noData = document.getElementById("subagent-no-data-message");

  tbody.replaceChildren();

  if (bySubagent.length === 0) {
    table.hidden = true;
    noData.hidden = false;
    return;
  }

  table.hidden = false;
  noData.hidden = true;

  for (const row of bySubagent) {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.tabIndex = 0;

    const typeCell = document.createElement("td");
    typeCell.textContent = row.subagentType;

    const countCell = document.createElement("td");
    countCell.textContent = String(row.count);

    const outcomesCell = document.createElement("td");
    const outcomesWrap = document.createElement("div");
    outcomesWrap.className = "outcome-mini-badges";
    for (const outcome of OUTCOMES) {
      const count = row.outcomes[outcome] ?? 0;
      if (count === 0) {
        continue;
      }
      const badge = outcomeBadge(outcome);
      badge.textContent = `${badge.textContent} ${count}`;
      outcomesWrap.append(badge);
    }
    outcomesCell.append(outcomesWrap);

    tr.append(typeCell, countCell, outcomesCell);
    tr.addEventListener("click", () => {
      state.eventsReturnView = "subagent";
      openEventsView({ subagentType: row.subagentType }).catch(handleRefreshError);
    });
    tbody.append(tr);
  }
}

function sumBucketCounts(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

// Formats a bucket's per-tool/per-subagent-type counts as a short text
// breakdown line under its bar, e.g. "Bash: 3, Read: 2, Explore (subagent): 1".
function formatTrendBreakdown(bucket) {
  const parts = [];
  for (const [toolName, count] of Object.entries(bucket.toolCounts)) {
    parts.push(`${toolName}: ${count}`);
  }
  for (const [subagentType, count] of Object.entries(bucket.subagentCounts)) {
    parts.push(`${subagentType} (subagent): ${count}`);
  }
  return parts.join(", ");
}

// Renders the trend view as plain bar/sparkline markup (User Story 4, FR-007)
// — no charting library, just a labeled div per bucket whose width is
// proportional to that period's total invocation count. Every bucket the API
// returns is rendered, including zero-activity ones (an empty-width bar with
// "No activity" instead of a breakdown line), so a quiet period is visibly
// present rather than silently missing from the chart (same "shown as zero,
// not omitted" contract as the tool/subagent breakdowns, FR-010-style).
function renderTrendChart(buckets) {
  const container = document.getElementById("trend-chart");
  container.replaceChildren();

  const totals = buckets.map((bucket) => sumBucketCounts(bucket.toolCounts) + sumBucketCounts(bucket.subagentCounts));
  const maxTotal = Math.max(1, ...totals);

  buckets.forEach((bucket, index) => {
    const total = totals[index];

    const row = document.createElement("div");
    row.className = "trend-row";

    const label = document.createElement("span");
    label.className = "trend-label";
    label.textContent = bucket.bucket;

    const barTrack = document.createElement("span");
    barTrack.className = "trend-bar-track";
    const bar = document.createElement("span");
    bar.className = "trend-bar";
    bar.classList.toggle("trend-bar-empty", total === 0);
    bar.style.width = `${(total / maxTotal) * 100}%`;
    barTrack.append(bar);

    const countLabel = document.createElement("span");
    countLabel.className = "trend-count";
    countLabel.textContent = String(total);

    row.append(label, barTrack, countLabel);

    const breakdown = document.createElement("p");
    breakdown.className = "trend-breakdown";
    const breakdownText = formatTrendBreakdown(bucket);
    breakdown.textContent = total === 0 ? "No activity" : breakdownText;
    breakdown.classList.toggle("muted", total === 0);

    const wrapper = document.createElement("div");
    wrapper.className = "trend-bucket";
    wrapper.append(row, breakdown);
    container.append(wrapper);
  });
}

function setActiveGranularityButton(granularity) {
  for (const btn of document.querySelectorAll(".granularity-btn")) {
    btn.classList.toggle("is-active", btn.dataset.granularity === granularity);
  }
}

async function openTrendView() {
  const params = new URLSearchParams({ range: state.range, granularity: state.trendGranularity });
  const data = await fetchJson(`/api/trend?${params.toString()}`);
  renderTrendChart(data.buckets);
  showView("trend");
}

// Renders the filtered event list. Each row shows only the list-shape flags
// from GET /api/events (hasReasoning/hasValidation) — full text is fetched
// lazily via the detail endpoint when a row is opened, keeping list
// payloads small per contracts/api.md.
function renderEventTable(events) {
  const table = document.getElementById("event-table");
  const tbody = document.getElementById("event-table-body");
  const empty = document.getElementById("event-list-empty");

  tbody.replaceChildren();

  if (events.length === 0) {
    table.hidden = true;
    empty.hidden = false;
    return;
  }

  table.hidden = false;
  empty.hidden = true;

  for (const row of events) {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.tabIndex = 0;

    const timeCell = document.createElement("td");
    timeCell.textContent = new Date(row.timestamp).toLocaleString();

    const toolCell = document.createElement("td");
    toolCell.textContent = row.isSubagent ? `${row.toolName} (subagent)` : row.toolName;

    const outcomeCell = document.createElement("td");
    outcomeCell.append(outcomeBadge(row.outcome));

    const reasoningCell = document.createElement("td");
    reasoningCell.textContent = row.hasReasoning ? "Captured" : "Not captured";
    reasoningCell.classList.toggle("muted", !row.hasReasoning);

    const validationCell = document.createElement("td");
    validationCell.textContent = row.hasValidation ? "Observed" : "—";
    validationCell.classList.toggle("muted", !row.hasValidation);

    tr.append(timeCell, toolCell, outcomeCell, reasoningCell, validationCell);
    tr.addEventListener("click", () => openEventDetail(row.eventId).catch(handleRefreshError));
    tbody.append(tr);
  }
}

// Renders the "why" (reasoning) field, distinguishing "not captured" (no
// reasoning text was found near the tool call) from having real text
// (FR-012, FR-016) — the client never fabricates a value for a null field.
function renderReasoning(reasoning) {
  const el = document.getElementById("detail-reasoning");
  el.classList.toggle("muted", reasoning === null);
  el.textContent = reasoning === null ? "Not captured" : reasoning;
}

// Renders the validation-check outcome, visibly distinguishing all four
// heuristic states (research.md §6) — in particular "not applicable" (this
// tool has nothing to check) from "not observed" (a check could have
// happened but wasn't seen) and from actual "not captured" reasoning above;
// these are never collapsed into a single generic "N/A" (FR-016).
function renderValidation(validation) {
  const el = document.getElementById("detail-validation");
  el.classList.remove("muted");

  if (validation === null) {
    el.textContent = "Not observed";
    el.classList.add("muted");
    return;
  }

  switch (validation.result) {
    case "confirmed":
      el.textContent = `Confirmed — ${validation.checkedWhat}`;
      break;
    case "mismatch_corrected":
      el.textContent = `Mismatch found and corrected — ${validation.checkedWhat}`;
      break;
    case "not_applicable":
      el.textContent = "Not applicable — this tool has no result to verify";
      el.classList.add("muted");
      break;
    case "not_observed":
    default:
      el.textContent = "Not observed — no follow-up check was detected";
      el.classList.add("muted");
      break;
  }
}

async function openEventsView(filter) {
  state.eventsFilter = filter;
  const params = new URLSearchParams({ range: state.range, ...filter });
  const data = await fetchJson(`/api/events?${params.toString()}`);
  renderEventTable(data.events);
  showView("events");
}

// Toggles + fills the subagent-only detail fields (User Story 3): reuses the
// same US2 detail view used for every invocation, just surfacing two
// additional fields (subagentType/subagentTask) when this invocation was a
// Task delegation. Hidden entirely for non-subagent invocations rather than
// shown empty.
function renderSubagentDetailFields(detail) {
  const fieldIds = [
    "detail-subagent-type-label",
    "detail-subagent-type",
    "detail-subagent-task-label",
    "detail-subagent-task",
  ];
  for (const id of fieldIds) {
    document.getElementById(id).hidden = !detail.isSubagent;
  }
  if (!detail.isSubagent) {
    return;
  }

  const typeEl = document.getElementById("detail-subagent-type");
  typeEl.classList.toggle("muted", detail.subagentType === null);
  typeEl.textContent = detail.subagentType === null ? "Not captured" : detail.subagentType;

  const taskEl = document.getElementById("detail-subagent-task");
  taskEl.classList.toggle("muted", detail.subagentTask === null);
  taskEl.textContent = detail.subagentTask === null ? "Not captured" : detail.subagentTask;
}

async function openEventDetail(eventId) {
  const detail = await fetchJson(`/api/events/${encodeURIComponent(eventId)}`);

  document.getElementById("detail-tool").textContent = detail.isSubagent
    ? `${detail.toolName} (subagent)`
    : detail.toolName;

  const outcomeCell = document.getElementById("detail-outcome");
  outcomeCell.replaceChildren(outcomeBadge(detail.outcome));

  renderSubagentDetailFields(detail);
  renderReasoning(detail.reasoning);
  document.getElementById("detail-input").textContent =
    detail.inputSummary === null ? "Not captured" : detail.inputSummary;
  renderValidation(detail.validation);

  showView("detail");
}

function setActiveRangeButton(range) {
  for (const btn of document.querySelectorAll(".range-btn")) {
    btn.classList.toggle("is-active", btn.dataset.range === range);
  }
}

async function refresh() {
  const status = await fetchJson("/api/status");

  if (!status.hasTranscriptSource || status.sessionCount === 0) {
    renderStatusMessage(status.message);
    renderToolTable([]);
    renderSubagentTable([]);
    return;
  }

  renderStatusMessage(null);
  const summary = await fetchJson(`/api/summary?range=${encodeURIComponent(state.range)}`);
  renderToolTable(summary.byTool);
  renderSubagentTable(summary.bySubagent);
}

function handleRefreshError(error) {
  console.error(error);
  renderStatusMessage("Failed to load usage data. See the browser console for details.");
}

function init() {
  for (const btn of document.querySelectorAll(".range-btn")) {
    btn.addEventListener("click", () => {
      state.range = btn.dataset.range;
      setActiveRangeButton(state.range);
      if (state.view === "breakdown" || state.view === "subagent") {
        refresh().catch(handleRefreshError);
      } else if (state.view === "trend") {
        openTrendView().catch(handleRefreshError);
      } else if (state.eventsFilter) {
        openEventsView(state.eventsFilter).catch(handleRefreshError);
      }
    });
  }

  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => {
      setActiveTab(btn.dataset.view);
      if (btn.dataset.view === "trend") {
        openTrendView().catch(handleRefreshError);
      } else {
        showView(btn.dataset.view);
      }
    });
  }

  for (const btn of document.querySelectorAll(".granularity-btn")) {
    btn.addEventListener("click", () => {
      state.trendGranularity = btn.dataset.granularity;
      setActiveGranularityButton(state.trendGranularity);
      openTrendView().catch(handleRefreshError);
    });
  }

  document.getElementById("back-to-breakdown").addEventListener("click", () => {
    const target = state.eventsReturnView;
    setActiveTab(target);
    refresh()
      .then(() => showView(target))
      .catch(handleRefreshError);
  });

  document.getElementById("back-to-events").addEventListener("click", () => {
    if (state.eventsFilter) {
      openEventsView(state.eventsFilter).catch(handleRefreshError);
    } else {
      setActiveTab(state.eventsReturnView);
      showView(state.eventsReturnView);
    }
  });

  refresh().catch(handleRefreshError);
}

document.addEventListener("DOMContentLoaded", init);
