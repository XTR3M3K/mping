import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";

export interface HttpProbeOptions {
  secure: boolean;
  host: string;
  port: number;
  path: string;
  timeoutMs: number;
  /** Reject self-signed / expired certificates (https only). */
  verifyTls: boolean;
  /** Exact status to require; null accepts anything below 400. */
  expectStatus: number | null;
}

/** IPv6 literals need brackets in a Host header / URL. */
function hostHeader(host: string, port: number, secure: boolean): string {
  const bare = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const isDefault = (secure && port === 443) || (!secure && port === 80);
  return isDefault ? bare : `${bare}:${port}`;
}

function statusOk(status: number, expect: number | null): boolean {
  return expect == null ? status < 400 : status === expect;
}

/**
 * Time one HTTP(S) request up to the response headers — the number an operator
 * cares about (connect + TLS + server think time), without being skewed by the
 * size of the body. Resolves null on timeout, transport error, or an
 * unexpected status code; those count as loss.
 */
export function httpOnce(opts: HttpProbeOptions): Promise<number | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const settle = (rtt: number | null): boolean => {
      if (settled) return false;
      settled = true;
      resolve(rtt);
      return true;
    };

    const options: https.RequestOptions = {
      host: opts.host,
      port: opts.port,
      path: opts.path || "/",
      method: "GET",
      headers: {
        host: hostHeader(opts.host, opts.port, opts.secure),
        "user-agent": "mping-agent",
        accept: "*/*",
        connection: "close",
      },
      // TLS options are simply unused by the plain-http module.
      rejectUnauthorized: opts.verifyTls,
      timeout: opts.timeoutMs,
    };

    const onResponse = (res: http.IncomingMessage): void => {
      const rtt = performance.now() - started;
      const ok = statusOk(res.statusCode ?? 0, opts.expectStatus);
      res.resume(); // drain so the socket can close cleanly
      if (settle(ok ? rtt : null)) res.destroy();
    };

    const req = opts.secure ? https.request(options, onResponse) : http.request(options, onResponse);

    req.setTimeout(opts.timeoutMs, () => {
      if (settle(null)) req.destroy();
    });
    req.once("error", () => {
      if (settle(null)) req.destroy();
    });
    req.end();
  });
}
