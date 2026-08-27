import net from "node:net";
import { performance } from "node:perf_hooks";

/**
 * Time a single TCP handshake. Resolves the connect time in ms, or null when
 * the attempt failed or timed out (counted as loss, exactly like a dropped
 * ICMP echo).
 */
export function tcpOnce(host: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const socket = net.connect({ host, port });

    const settle = (rtt: number | null): boolean => {
      if (settled) return false;
      settled = true;
      resolve(rtt);
      return true;
    };

    socket.setTimeout(timeoutMs, () => {
      if (settle(null)) socket.destroy();
    });
    socket.once("connect", () => {
      // Close with a FIN rather than a reset so the far side doesn't log an
      // error for every cycle we run against it.
      if (settle(performance.now() - started)) socket.end();
    });
    socket.once("error", () => {
      if (settle(null)) socket.destroy();
    });
    socket.once("close", () => socket.destroy());
  });
}
