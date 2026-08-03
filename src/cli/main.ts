#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { defaultTranscriptRoot } from "../ingest/discover-transcripts.js";
import { syncTranscripts } from "../ingest/sync.js";
import { createDashboardHandler, createHttpServer, listen } from "../server/http-server.js";
import { defaultDbPath, openDatabase } from "../storage/repository.js";

const DEFAULT_PORT = 4317;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function printUsage(): void {
  console.error("Usage: observe <serve|sync> [--port <number>]");
}

async function runServe(port: number): Promise<void> {
  const db = openDatabase();
  const staticDir = join(MODULE_DIR, "..", "server", "static");
  const server = createHttpServer(createDashboardHandler({ db, staticDir }));
  const actualPort = await listen(server, port);
  console.log(`Dashboard listening on http://127.0.0.1:${actualPort}`);
  console.log(`Database: ${defaultDbPath()}`);
  console.log(`Transcript root: ${defaultTranscriptRoot()}`);
}

function runSync(): void {
  const db = openDatabase();
  try {
    syncTranscripts(db);
    console.log(`Synced transcripts from ${defaultTranscriptRoot()} into ${defaultDbPath()}`);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      port: { type: "string" },
    },
  });

  const command = positionals[0];
  const port = values.port !== undefined ? Number.parseInt(values.port, 10) : DEFAULT_PORT;

  switch (command) {
    case "serve":
      await runServe(port);
      break;
    case "sync":
      runSync();
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
