import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

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
