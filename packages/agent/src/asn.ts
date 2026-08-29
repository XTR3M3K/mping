import { promises as dns } from "node:dns";
import { isIPv4, isIPv6 } from "node:net";

/**
 * Origin-AS lookup over Team Cymru's DNS service — no API key, no HTTP, and it
 * rides the resolver the agent already uses for reverse DNS.
 *
 *   1.0.0.1  →  1.0.0.1.origin.asn.cymru.com  TXT
 *              "13335 | 1.0.0.0/24 | AU | apnic | 2011-08-11"
 *   AS13335  →  AS13335.asn.cymru.com         TXT
 *              "13335 | US | arin | 2010-07-14 | CLOUDFLARENET, US"
 *
 * Failures are cached as "unknown" so a network that blocks the lookup costs
 * one timeout per address, not one per traceroute cycle.
 */

export interface AsnInfo {
  asn: number | null;
  as_name: string | null;
}

const UNKNOWN: AsnInfo = { asn: null, as_name: null };

const TTL_MS = 12 * 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 2000;

const ipCache = new Map<string, { info: AsnInfo; at: number }>();
const nameCache = new Map<number, { name: string | null; at: number }>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("dns timeout")), ms)),
  ]);
}

/** Addresses with no public origin AS — don't waste a query on them. */
function isPrivate(ip: string): boolean {
  if (isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return a >= 224; // multicast + reserved
  }
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd");
}

/** `1.2.3.4` → `4.3.2.1`; IPv6 → reversed nibbles, as the DNS zones expect. */
function reverseForQuery(ip: string): string | null {
  if (isIPv4(ip)) return ip.split(".").reverse().join(".");
  if (!isIPv6(ip)) return null;
  const groups = expandIPv6(ip);
  if (!groups) return null;
  return groups.split("").reverse().join(".");
}

/** Expand an IPv6 address to its 32 hex nibbles, or null if unparseable. */
function expandIPv6(ip: string): string | null {
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":").filter(Boolean) : [];
  const right = tail ? tail.split(":").filter(Boolean) : [];
  if (tail === undefined && left.length !== 8) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  return groups.map((g) => g.padStart(4, "0")).join("").toLowerCase();
}

async function txt(name: string): Promise<string[]> {
  const records = await withTimeout(dns.resolveTxt(name), QUERY_TIMEOUT_MS);
  return records.map((chunks) => chunks.join(""));
}

/** Cymru returns pipe-separated fields; the first can list several origins. */
function firstAsn(record: string): number | null {
  const first = record.split("|")[0]?.trim().split(/\s+/)[0];
  const asn = Number(first);
  return Number.isInteger(asn) && asn > 0 ? asn : null;
}

async function lookupName(asn: number): Promise<string | null> {
  const cached = nameCache.get(asn);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.name;
  let name: string | null = null;
  try {
    const record = (await txt(`AS${asn}.asn.cymru.com`))[0];
    // "13335 | US | arin | 2010-07-14 | CLOUDFLARENET, US" — keep the org, drop
    // the trailing country that Cymru appends.
    const org = record?.split("|").pop()?.trim() ?? "";
    name = org ? org.replace(/,\s*[A-Z]{2}$/, "") || null : null;
  } catch {
    name = null;
  }
  nameCache.set(asn, { name, at: Date.now() });
  return name;
}

/** Best-effort origin AS for a hop IP (cached, time-boxed, never throws). */
export async function lookupAsn(ip: string): Promise<AsnInfo> {
  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.info;

  let info = UNKNOWN;
  if (!isPrivate(ip)) {
    const reversed = reverseForQuery(ip);
    const zone = isIPv4(ip) ? "origin.asn.cymru.com" : "origin6.asn.cymru.com";
    if (reversed) {
      try {
        const asn = firstAsn((await txt(`${reversed}.${zone}`))[0] ?? "");
        if (asn != null) info = { asn, as_name: await lookupName(asn) };
      } catch {
        info = UNKNOWN; // no route object, blocked resolver, or timeout
      }
    }
  }
  ipCache.set(ip, { info, at: Date.now() });
  return info;
}
