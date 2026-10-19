import { createServer, request } from "node:http";

import { WebSocketServer } from "ws";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebSocket } from "ws";

/** Browser fixture only; native relay behavior is independently tested by LanServerTest. */
export const networkProxy = async (
  port: number,
  connected: (socket: WebSocket, request: IncomingMessage) => void,
  route?: (request: IncomingMessage, response: ServerResponse) => boolean,
) => {
  const server = createServer((incoming, outgoing) => {
    if (route?.(incoming, outgoing)) {
      return;
    }
    const proxy = request(
      `http://127.0.0.1:4173${incoming.url || "/"}`,
      {
        headers: { ...incoming.headers, host: "127.0.0.1:4173" },
        method: incoming.method,
      },
      (response) => {
        outgoing.writeHead(response.statusCode || 500, response.headers);
        response.pipe(outgoing);
      },
    );
    proxy.on("error", () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(proxy);
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", connected);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    sockets,
    close: async () => {
      sockets.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
