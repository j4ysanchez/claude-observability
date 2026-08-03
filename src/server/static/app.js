// Vanilla-JS dashboard frontend (no build step, no framework) — fetches the
// JSON API in contracts/api.md and renders it with plain DOM calls.

const state = { range: "today" };

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

// Renders the per-tool breakdown table, or the "no data" message in its
// place instead of an empty/misleading table (FR-010).
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

    const toolCell = document.createElement("td");
    toolCell.textContent = row.toolName;

    const countCell = document.createElement("td");
    countCell.textContent = String(row.count);

    tr.append(toolCell, countCell);
    tbody.append(tr);
  }
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
      refresh().catch(handleRefreshError);
    });
  }

  refresh().catch(handleRefreshError);
}

document.addEventListener("DOMContentLoaded", init);
