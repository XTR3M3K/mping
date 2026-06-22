import { useEffect, useRef } from "react";
import { WsMessageSchema, type WsMessage } from "@mping/shared";

/**
 * Subscribe to the server's live WebSocket feed. The handler is kept in a ref
 * so re-renders don't tear down the socket. Auto-reconnects with backoff.
 */
export function useLiveFeed(onMessage: (msg: WsMessage) => void): void {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${location.host}/api/ws`);
      socket.onopen = () => {
        retry = 0;
      };
      socket.onmessage = (ev) => {
        try {
          const parsed = WsMessageSchema.safeParse(JSON.parse(ev.data));
          if (parsed.success) handlerRef.current(parsed.data);
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, 500 * 2 ** (retry - 1));
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);
}
