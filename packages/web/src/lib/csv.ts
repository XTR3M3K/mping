import { defaultPort, type ProbeType, type TargetCreate } from "@mping/shared";

/** Mirrors the lower bound in TargetSchema, so the preview flags it early. */
const MIN_INTERVAL_SEC = 5;

/**
 * A small RFC 4180 reader — quoted fields, doubled quotes, CRLF — plus the
 * concessions a real spreadsheet export needs: a UTF-8 BOM and the semicolon
 * delimiter Excel writes in locales where the comma is a decimal separator.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === delim) (row.push(field), (field = ""));
    else if (c === "\n") (row.push(field), (field = ""), rows.push(row), (row = []));
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) (row.push(field), rows.push(row));

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function detectDelimiter(src: string): string {
  const line = src.slice(0, src.indexOf("\n") === -1 ? src.length : src.indexOf("\n"));
  const counts = [",", ";", "\t"].map((d) => [d, line.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts.sort((a, b) => b[1] - a[1])[0]![0] : ",";
}

/** Header spellings we accept for each field, beyond the field name itself. */
const ALIASES: Record<string, string> = {
  address: "host",
  ip: "host",
  hostname: "host",
  target: "host",
  probe: "type",
  kind: "type",
  group: "group_name",
  folder: "group_name",
  interval: "interval_sec",
  interval_s: "interval_sec",
  count: "ping_count",
  pings: "ping_count",
  checks: "ping_count",
  size: "packet_size",
  path: "http_path",
  url_path: "http_path",
  expect_status: "http_expect_status",
  status: "http_expect_status",
  tls_verify: "verify_tls",
  timeout: "timeout_ms",
  latency_threshold: "latency_threshold_ms",
  latency: "latency_threshold_ms",
  loss_threshold: "alert_on_loss_pct",
  loss: "alert_on_loss_pct",
  traceroute: "traceroute_enabled",
  traceroute_interval: "traceroute_interval_sec",
  webhook: "discord_webhook_url",
  discord: "discord_webhook_url",
};

const BOOL_TRUE = new Set(["1", "true", "yes", "y", "on", "tak", "t"]);
const BOOL_FALSE = new Set(["0", "false", "no", "n", "off", "nie", "f"]);

function normalizeHeader(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
  return ALIASES[key] ?? key;
}

export interface CsvIssue {
  /** 1-based line in the file, so it matches what the editor shows. */
  line: number;
  message: string;
}

export interface CsvParseResult {
  targets: TargetCreate[];
  issues: CsvIssue[];
  /** Headers present in the file that mping doesn't know about. */
  unknownColumns: string[];
}

const BOOLEAN_FIELDS = ["enabled", "verify_tls", "traceroute_enabled"] as const;
const NUMBER_FIELDS = [
  "interval_sec", "ping_count", "packet_size", "port", "http_expect_status", "timeout_ms",
  "latency_threshold_ms", "alert_on_loss_pct", "traceroute_interval_sec",
] as const;
const TEXT_FIELDS = ["name", "host", "group_name", "http_path", "discord_webhook_url"] as const;

const KNOWN = new Set<string>([...BOOLEAN_FIELDS, ...NUMBER_FIELDS, ...TEXT_FIELDS, "type"]);

/**
 * `ok: false` means the cell was filled in but unusable. That has to fail the
 * row rather than fall back to ping: silently monitoring something other than
 * what the file asked for is worse than refusing the line.
 */
function parseType(raw: string, line: number, issues: CsvIssue[]): { value?: ProbeType; ok: boolean } {
  const v = raw.trim().toLowerCase();
  if (v === "") return { ok: true };
  if (v === "ping" || v === "icmp") return { value: "ping", ok: true };
  if (v === "tcp" || v === "http" || v === "https") return { value: v, ok: true };
  issues.push({ line, message: `unknown probe type "${raw}" (use ping, tcp, http or https)` });
  return { ok: false };
}

/**
 * Turn parsed CSV rows into probe payloads. Rows that can't be used are
 * reported rather than dropped silently — an import that quietly skips half a
 * file is worse than one that refuses it.
 */
export function csvToTargets(rows: string[][]): CsvParseResult {
  const issues: CsvIssue[] = [];
  const targets: TargetCreate[] = [];
  if (rows.length === 0) return { targets, issues: [{ line: 1, message: "the file is empty" }], unknownColumns: [] };

  const headers = rows[0]!.map(normalizeHeader);
  const unknownColumns = [...new Set(headers.filter((h) => h && !KNOWN.has(h)))];
  if (!headers.includes("name") || !headers.includes("host")) {
    return {
      targets,
      issues: [{ line: 1, message: "the header row must include at least name and host" }],
      unknownColumns,
    };
  }

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2; // header is line 1
    const get = (field: string): string => {
      const at = headers.indexOf(field);
      return at === -1 ? "" : (cells[at] ?? "").trim();
    };

    const name = get("name");
    const host = get("host");
    if (!name || !host) {
      issues.push({ line, message: `${!name ? "name" : "host"} is empty` });
      return;
    }

    const draft: Record<string, unknown> = { name, host };
    const type = parseType(get("type"), line, issues);
    if (type.value) draft.type = type.value;

    let broken = !type.ok;
    for (const field of NUMBER_FIELDS) {
      const raw = get(field);
      if (raw === "") continue;
      const n = Number(raw.replace(",", "."));
      if (!Number.isFinite(n)) {
        issues.push({ line, message: `${field} is not a number ("${raw}")` });
        broken = true;
        continue;
      }
      draft[field] = n;
    }
    for (const field of BOOLEAN_FIELDS) {
      const raw = get(field).toLowerCase();
      if (raw === "") continue;
      if (BOOL_TRUE.has(raw)) draft[field] = true;
      else if (BOOL_FALSE.has(raw)) draft[field] = false;
      else {
        issues.push({ line, message: `${field} is not a yes/no value ("${raw}")` });
        broken = true;
      }
    }
    for (const field of TEXT_FIELDS) {
      if (field === "name" || field === "host") continue;
      const raw = get(field);
      if (raw !== "") draft[field] = raw;
    }
    if (broken) return;

    // A TCP probe is unusable without a port, and http/https can borrow the
    // scheme default — the same rule the editor applies.
    const effective = (draft.type as ProbeType | undefined) ?? "ping";
    if (draft.port == null && effective !== "ping") draft.port = defaultPort(effective);
    if (effective === "tcp" && draft.port == null) {
      issues.push({ line, message: "a tcp probe needs a port" });
      return;
    }
    if (typeof draft.interval_sec === "number" && draft.interval_sec < MIN_INTERVAL_SEC) {
      issues.push({ line, message: `interval_sec must be at least ${MIN_INTERVAL_SEC}` });
      return;
    }

    targets.push(draft as unknown as TargetCreate);
  });

  return { targets, issues, unknownColumns };
}

/** A ready-to-fill file, so nobody has to guess the column names. */
export const CSV_TEMPLATE = [
  "name,host,type,port,http_path,http_expect_status,group_name,interval_sec,ping_count,latency_threshold_ms,alert_on_loss_pct,traceroute_enabled",
  "Cloudflare DNS,1.1.1.1,ping,,,,EMEA/Anycast,60,20,80,20,yes",
  "Core router,10.0.0.1,ping,,,,EMEA/Backbone,30,10,,,yes",
  "DNS over TLS,1.1.1.1,tcp,853,,,EMEA/Anycast,60,4,,,no",
  "Status page,example.com,https,,/health,200,Services,60,4,500,,no",
  "",
].join("\n");
