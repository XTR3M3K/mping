import type { WsMessage } from "@mping/shared";
import type { WebSocket } from "@fastify/websocket";

const clients = new Set<WebSocket>();

export function registerWsClient(socket: WebSocket): void {
  clients.add(socket);
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
}

/** Fan-out a live message to every connected dashboard. */
export function broadcast(msg: WsMessage): void {
  const data = JSON.stringify(msg);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) {
      try {
        socket.send(data);
      } catch {
        clients.delete(socket);
      }
    }
  }
}
