# Implementation Plan: Claude Code Tool & Subagent Usage Observability

**Branch**: `001-tool-usage-observability` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-tool-usage-observability/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Give a developer visibility into how they actually use Claude Code — which tools and
subagents fire, why, with what inputs, whether the agent checked its own results, and how
that changes over time — by parsing Claude Code's existing local session transcripts
(`~/.claude/projects/**/*.jsonl`), incrementally loading the derived events into a local
SQLite database, and serving breakdowns/drill-downs/trends through a small localhost-only
web dashboard. No new instrumentation inside Claude Code itself is required; the transcript
is the source of truth (per spec Assumptions). Everything runs on-machine, offline, single
user, single process.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+ (LTS)

**Primary Dependencies**: `better-sqlite3` (synchronous local storage, no async ceremony,
single-writer is sufficient); Node's built-in `node:http` + `node:util.parseArgs` for the
dashboard server and CLI entry point (no Express/Fastify/yargs — a handful of JSON routes
and flags don't justify a framework per Simplicity First); a static, dependency-free
HTML/CSS/vanilla-JS frontend served by that same process (no React/Vue/build step for a
single local read-mostly dashboard)

**Storage**: SQLite, single file at `~/.claude-observability/usage.db`, written via
`better-sqlite3` prepared statements (no ORM)

**Testing**: Vitest — unit tests against the pure functional core (transcript-line →
Usage Event parsing/redaction/aggregation) using real fixture JSONL excerpts, no mocks;
integration tests for the boundary modules (file reading + incremental cursors, SQLite
read/write, HTTP handlers) against real temp files and a real temp SQLite DB

**Target Platform**: Local developer machine (macOS/Linux/Windows), Node.js CLI that opens
a localhost-bound web dashboard in the developer's browser

**Project Type**: Single project (one local CLI/server tool; the static frontend it serves
is part of the same package/deployment unit, not an independently built/deployed app —
see Structure Decision below)

**Performance Goals**: Aggregate breakdown/trend queries return in <200ms for datasets up
to ~1M usage events (SQLite with indices on `session_id`, `tool_name`, `timestamp`);
incremental ingest of one typical session (hundreds of transcript lines) completes in
well under 1s

**Constraints**: Fully offline at runtime except binding to `localhost` for the dashboard
(FR-011) — no outbound network calls; known secret/credential patterns MUST be redacted
before any write to SQLite (FR-017), never stored raw even transiently on disk; single
local SQLite writer (no concurrent multi-process write contention to design for, since
there is exactly one developer and one dashboard process)

**Scale/Scope**: Single developer; potentially dozens of local projects and thousands of
sessions accumulated over a year (spec Assumptions: indefinite local retention) — design
for on the order of 10^5–10^6 usage events without degradation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Simplicity First | No framework (Express, React, an ORM, yargs) is introduced; Node built-ins cover CLI parsing and HTTP; SQLite accessed directly via prepared statements. Single project, single process. | PASS |
| II. Immutable Data, Pure Functions | Transcript parsing, redaction, and aggregation are implemented as pure functions over readonly/immutable record shapes (transcript line → `UsageEvent`, `UsageEvent[]` → `UsageSummary`). All I/O (reading `.jsonl` files, SQLite reads/writes, HTTP request/response) is isolated in boundary modules (`ingest/`, `storage/`, `server/`) that call into the pure core rather than embedding logic in it. | PASS |
| III. Composability Over Inheritance | No class hierarchies. Ingestion is a pipeline of small functions (read lines → parse record → classify outcome → extract reasoning/input/validation → redact → shape `UsageEvent`) composed left-to-right; each stage is independently testable. | PASS |
| IV. Decoupling Through Explicit Boundaries | `ingest` (transcript → events), `storage` (events ↔ SQLite), `api`/`server` (HTTP ↔ storage), and the static frontend (HTTP ↔ DOM) each communicate only through explicit function signatures / the JSON API contract in `contracts/api.md` — no shared mutable state or reach-through access. | PASS |
| V. Secure by Default | Redaction (FR-017) runs inside the pure core before any event reaches the storage boundary, so nothing unredacted ever touches disk. Dashboard server binds to `127.0.0.1` only, no external network exposure, no auth needed (single local user, FR-011). No secrets are logged. | PASS |

No violations to record in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── core/                 # pure functional core (no I/O)
│   ├── parse-transcript.ts    # jsonl line -> raw record
│   ├── classify-outcome.ts    # succeeded | failed | denied | in_progress
│   ├── extract-context.ts     # why (reasoning) / how (input) / validation extraction
│   ├── redact.ts               # secret/credential pattern redaction (FR-017)
│   ├── build-usage-event.ts    # composed pipeline -> UsageEvent / SubagentInvocation
│   └── summarize.ts            # UsageEvent[] rows -> UsageSummary shapes (trend/breakdown)
├── ingest/               # boundary: filesystem
│   ├── discover-transcripts.ts # walk ~/.claude/projects/**/*.jsonl
│   └── incremental-reader.ts   # cursor-based tailing of a transcript file
├── storage/              # boundary: SQLite
│   ├── schema.ts               # CREATE TABLE statements, migrations
│   └── repository.ts           # prepared-statement read/write functions
├── server/               # boundary: HTTP
│   ├── http-server.ts          # localhost-only listener
│   ├── routes.ts               # maps contracts/api.md endpoints to repository calls
│   └── static/                 # dashboard frontend (html/css/vanilla js, no build step)
└── cli/
    └── main.ts               # `observe` entry point (parseArgs: serve, sync, --port)

tests/
├── unit/            # core/* — pure functions, fixture-driven, no mocks
├── integration/     # ingest/*, storage/*, server/* — real temp files/db, real HTTP calls
└── fixtures/        # sample .jsonl transcript excerpts (tool_use, Task, denial, error, secrets)
```

**Structure Decision**: Single project (Option 1). This is one local CLI/server tool, not
a client/server pair with independent lifecycles — the dashboard frontend in
`src/server/static/` is static assets served by the same process that does ingestion and
storage, shipped and versioned together. `core/` holds the constitution's "functional
core" (pure, no I/O); `ingest/`, `storage/`, and `server/` are the "imperative shell"
boundary modules per Principle II/IV.

## Post-Design Constitution Check

*Re-evaluated after Phase 1 (research.md, data-model.md, contracts/api.md, quickstart.md).*

| Principle | Re-check against final design | Status |
|---|---|---|
| I. Simplicity First | Final design adds no framework beyond what Technical Context named; `Usage Summary` stays a derived shape (no extra table); subagent invocations reuse the `usage_events` table instead of a parallel entity. | PASS |
| II. Immutable Data, Pure Functions | `data-model.md` shapes (`Session`, `UsageEvent`, `ValidationCheck`, `UsageSummary`) are plain readonly data; all transforms (`parse-transcript`, `classify-outcome`, `extract-context`, `redact`, `build-usage-event`, `summarize`) are pure per `research.md` and confined to `src/core/`. | PASS |
| III. Composability Over Inheritance | `SubagentInvocation` is composition (a `UsageEvent` row with `isSubagent=true`), not a subtype/subclass. Ingestion is a left-to-right function pipeline (research.md §1–§7). | PASS |
| IV. Decoupling Through Explicit Boundaries | `contracts/api.md` is the one explicit boundary between server and frontend; `core` ↔ `ingest`/`storage`/`server` communicate only via the typed shapes in `data-model.md`, never shared state. | PASS |
| V. Secure by Default | Redaction confirmed to run inside the pure core, before the value ever reaches a boundary module that could persist or log it (research.md §7); server binds `127.0.0.1` only (contracts/api.md). | PASS |

No violations. Complexity Tracking table below is intentionally empty.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*No entries — no Constitution Check violations were identified in this plan.*
