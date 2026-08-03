#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createHttpServer, listen } from "../server/http-server.js";
import { defaultDbPath, openDatabase } from "../storage/repository.js";

const DEFAULT_PORT = 4317;

function printUsage(): void {
  console.error("Usage: observe <serve|sync> [--port <number>]");
}

async function runServe(port: number): Promise<void> {
  openDatabase();
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  const actualPort = await listen(server, port);
  console.log(`Dashboard listening on http://127.0.0.1:${actualPort}`);
  console.log(`Database: ${defaultDbPath()}`);
}

function runSync(): void {
  console.log("Sync will be available once ingestion is implemented (User Story 1).");
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
