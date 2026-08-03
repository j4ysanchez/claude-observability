# claude-observability

A local, offline dashboard that shows you how you actually use Claude Code: which tools
and subagents fire, why, with what inputs, whether the agent checked its own work, and
how that changes over time.

It works by parsing your existing local Claude Code session transcripts
(`~/.claude/projects/**/*.jsonl`) — no new instrumentation inside Claude Code is
required — incrementally loading the derived events into a local SQLite database, and
serving breakdowns, drill-downs, and trends through a small localhost-only web
dashboard. Everything runs on your machine: no network calls, no external services, no
account.

## Prerequisites

- Node.js 20+

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

Compiles TypeScript to `dist/` and copies the static frontend
(`src/server/static/`) alongside it.

## Start the dashboard

```bash
npm start
```

This runs `node dist/cli/main.js serve` and opens a localhost-only HTTP server, by
default at `http://127.0.0.1:4317`. Every request to the dashboard first incrementally
syncs any new transcript activity, so the data you see is always current.

To use a different port:

```bash
node dist/cli/main.js serve --port 5000
```

(`npm start -- --port 5000` also works.)

## Sync manually

The dashboard syncs automatically on every request, but you can also trigger a one-off
sync from the command line (e.g. for scripting or to pre-warm the database) without
starting the server:

```bash
npm run sync
```

This runs `node dist/cli/main.js sync`.

## Where data is stored

All derived usage data lives in a single local SQLite file at
`~/.claude-observability/usage.db`. Nothing is sent anywhere; the database and the
dashboard server both stay on your machine, and the server binds to `127.0.0.1` only.

## Redaction & privacy

Before anything is written to disk, known secret/credential patterns (AWS-style keys,
bearer tokens, API keys, `password=`/`token=`-style pairs, PEM private key blocks, etc.)
are replaced with `[REDACTED]` — raw secrets from your transcripts are never persisted,
even transiently.
