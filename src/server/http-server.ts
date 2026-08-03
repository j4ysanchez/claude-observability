import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type Database from "better-sqlite3";
import {
  handleEventDetail,
  handleEventsList,
  handleStatus,
  handleSummary,
  handleTrend,
} from "./routes.js";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export function createHttpServer(handler: RouteHandler): Server {
  return createServer((req, res) => {
    void handler(req, res);
  });
}

export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address !== null ? address.port : port;
      resolve(actualPort);
    });
  });
}

const STATIC_MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function serveStaticFile(staticDir: string, urlPath: string, res: ServerResponse): void {
  const relativePath = urlPath === "/" ? "/index.html" : urlPath;
  const resolvedStaticDir = normalize(staticDir);
  const filePath = normalize(join(resolvedStaticDir, relativePath));

  if (
    !filePath.startsWith(resolvedStaticDir) ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
  ) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }

  const contentType = STATIC_MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": contentType });
  createReadStream(filePath).pipe(res);
}

export interface DashboardHandlerConfig {
  readonly db: Database.Database;
  readonly staticDir: string;
  /** Overrides the default `~/.claude/projects` transcript root — for tests. */
  readonly transcriptRoot?: string;
}

/**
 * Builds the request dispatcher for the dashboard: maps `contracts/api.md`
 * JSON routes to `routes.ts`, and falls back to serving the static
 * frontend (`src/server/static/`) for everything else.
 */
export function createDashboardHandler(config: DashboardHandlerConfig): RouteHandler {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, handleStatus(config.db, config.transcriptRoot));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/summary") {
      sendJson(
        res,
        200,
        handleSummary(config.db, url.searchParams.get("range"), config.transcriptRoot)
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/trend") {
      sendJson(
        res,
        200,
        handleTrend(
          config.db,
          url.searchParams.get("range"),
          url.searchParams.get("granularity"),
          config.transcriptRoot
        )
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      sendJson(
        res,
        200,
        handleEventsList(
          config.db,
          {
            range: url.searchParams.get("range"),
            tool: url.searchParams.get("tool"),
            subagentType: url.searchParams.get("subagentType"),
            sessionId: url.searchParams.get("sessionId"),
            page: url.searchParams.get("page"),
          },
          config.transcriptRoot
        )
      );
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/events/")) {
      const eventId = decodeURIComponent(url.pathname.slice("/api/events/".length));
      const detail = handleEventDetail(config.db, eventId, config.transcriptRoot);
      if (detail === null) {
        sendJson(res, 404, { error: "Not found" });
      } else {
        sendJson(res, 200, detail);
      }
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    serveStaticFile(config.staticDir, url.pathname, res);
  };
}
