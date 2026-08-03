// Vanilla-JS dashboard frontend (no build step, no framework) — fetches the
// JSON API in contracts/api.md and renders it with plain DOM calls.

// `view` tracks which of the three sections (breakdown/events/detail) is
// showing; `eventsFilter` is remembered so "Back to invocations" from the
// detail panel can re-render the same filtered list without re-prompting.
const state = { range: "today", view: "breakdown", eventsFilter: null };

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
  document.getElementById("event-list").hidden = view !== "events";
  document.getElementById("event-detail").hidden = view !== "detail";
  state.view = view;
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
    tr.addEventListener("click", () => openEventsView({ tool: row.toolName }).catch(handleRefreshError));
    tbody.append(tr);
  }
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

async function openEventDetail(eventId) {
  const detail = await fetchJson(`/api/events/${encodeURIComponent(eventId)}`);

  document.getElementById("detail-tool").textContent = detail.isSubagent
    ? `${detail.toolName} (subagent)`
    : detail.toolName;

  const outcomeCell = document.getElementById("detail-outcome");
  outcomeCell.replaceChildren(outcomeBadge(detail.outcome));

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
    return;
  }

  renderStatusMessage(null);
  const summary = await fetchJson(`/api/summary?range=${encodeURIComponent(state.range)}`);
  renderToolTable(summary.byTool);
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
      if (state.view === "breakdown") {
        refresh().catch(handleRefreshError);
      } else if (state.eventsFilter) {
        openEventsView(state.eventsFilter).catch(handleRefreshError);
      }
    });
  }

  document.getElementById("back-to-breakdown").addEventListener("click", () => {
    showView("breakdown");
    refresh().catch(handleRefreshError);
  });

  document.getElementById("back-to-events").addEventListener("click", () => {
    if (state.eventsFilter) {
      openEventsView(state.eventsFilter).catch(handleRefreshError);
    } else {
      showView("breakdown");
    }
  });

  refresh().catch(handleRefreshError);
}

document.addEventListener("DOMContentLoaded", init);
