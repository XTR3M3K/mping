import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Server, Copy, RefreshCw, KeyRound, Check } from "lucide-react";
import type { Target } from "@mping/shared";
import { api } from "../lib/api.js";
import { TargetEditor } from "../components/TargetEditor.js";
import { SectionTitle, StatusDot, Chip, Skeleton } from "../components/ui.js";
import { fmtRelTime } from "../lib/format.js";

export function Settings() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted mt-0.5">Probes, collectors, alerting & account</p>
      </div>
      <ProbesSection />
      <AlertingSection />
      <CollectorsSection />
      <AccountSection />
    </div>
  );
}

function ProbesSection() {
  const qc = useQueryClient();
  const { data: targets, isLoading } = useQuery({ queryKey: ["targets"], queryFn: api.listTargets });
  const [editing, setEditing] = useState<Target | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: (id: number) => api.deleteTarget(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["targets"] }),
  });

  return (
    <section>
      <SectionTitle right={<button className="btn-primary py-1.5" onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="h-4 w-4" /> Add</button>}>
        Probes
      </SectionTitle>
      <div className="card divide-y divide-border/50">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !targets?.length ? (
          <p className="p-6 text-center text-sm text-faint">No probes yet.</p>
        ) : (
          targets.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-3.5">
              <span className={`h-2 w-2 rounded-full shrink-0 ${t.enabled ? "bg-accent" : "bg-faint"}`} />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{t.name}</div>
                <div className="text-xs text-faint font-mono truncate">{t.host} · every {t.interval_sec}s · {t.ping_count} pings</div>
              </div>
              <div className="hidden sm:flex items-center gap-1.5">
                {t.group_name && <Chip>{t.group_name}</Chip>}
                {t.latency_threshold_ms != null && <Chip tone="accent">{t.latency_threshold_ms}ms</Chip>}
                {t.traceroute_enabled && <Chip tone="neutral">trace</Chip>}
              </div>
              <button className="btn-ghost py-1.5 px-2" onClick={() => { setEditing(t); setOpen(true); }}><Pencil className="h-4 w-4" /></button>
              <button className="btn-danger py-1.5 px-2" onClick={() => confirm(`Delete ${t.name}?`) && del.mutate(t.id)}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))
        )}
      </div>
      <TargetEditor open={open} onClose={() => setOpen(false)} target={editing} />
    </section>
  );
}

function AlertingSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [saved, setSaved] = useState(false);
  const mut = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });

  if (!data) return <Skeleton className="h-40 rounded-2xl" />;

  return (
    <section>
      <SectionTitle>Discord & alerting</SectionTitle>
      <div className="card p-4 space-y-4">
        <label className="block">
          <span className="label">Global Discord webhook</span>
          <input
            className="input font-mono text-xs mt-1.5"
            defaultValue={data.discord_webhook_url ?? ""}
            placeholder="https://discord.com/api/webhooks/…"
            onBlur={(e) => mut.mutate({ discord_webhook_url: e.target.value.trim() || null })}
          />
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="label">Default latency (ms)</span>
            <input type="number" className="input mt-1.5" defaultValue={data.default_latency_threshold_ms ?? ""} placeholder="off"
              onBlur={(e) => mut.mutate({ default_latency_threshold_ms: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <label className="block">
            <span className="label">Default loss (%)</span>
            <input type="number" className="input mt-1.5" defaultValue={data.default_alert_on_loss_pct ?? ""} placeholder="off"
              onBlur={(e) => mut.mutate({ default_alert_on_loss_pct: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <label className="block">
            <span className="label">Debounce (cycles)</span>
            <input type="number" min={1} className="input mt-1.5" defaultValue={data.alert_debounce_cycles}
              onBlur={(e) => mut.mutate({ alert_debounce_cycles: Math.max(1, Number(e.target.value)) })} />
          </label>
        </div>
        <p className="text-xs text-faint">Per-probe thresholds override these defaults. Changes save on blur. {saved && <span className="text-good">✓ saved</span>}</p>
      </div>
    </section>
  );
}

function CollectorsSection() {
  const qc = useQueryClient();
  const { data: collectors, isLoading } = useQuery({ queryKey: ["collectors"], queryFn: api.listCollectors });
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);

  const create = useMutation({
    mutationFn: () => api.createCollector(name.trim()),
    onSuccess: (res) => {
      setNewToken({ name: res.name, token: res.token });
      setName("");
      qc.invalidateQueries({ queryKey: ["collectors"] });
    },
  });
  const rotate = useMutation({
    mutationFn: (id: number) => api.rotateCollectorToken(id),
    onSuccess: (res, id) => setNewToken({ name: collectors?.find((c) => c.id === id)?.name ?? "collector", token: res.token }),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.deleteCollector(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collectors"] }),
  });

  return (
    <section>
      <SectionTitle>Collectors</SectionTitle>
      <div className="card p-4 space-y-3">
        <div className="flex gap-2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="hetzner, kat01a, …" onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()} />
          <button className="btn-primary shrink-0" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            <Plus className="h-4 w-4" /> Create
          </button>
        </div>

        {newToken && (
          <div className="rounded-xl border border-accent/40 bg-accent/10 p-3">
            <div className="text-sm font-medium mb-1">Token for “{newToken.name}” — copy it now, it won't be shown again:</div>
            <TokenReveal token={newToken.token} />
            <code className="block mt-2 text-[11px] text-muted break-all">
              MPING_NAME={newToken.name} MPING_TOKEN={newToken.token} pnpm --filter @mping/agent start
            </code>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-16" />
        ) : !collectors?.length ? (
          <p className="text-sm text-faint text-center py-4">No collectors yet. Create one, then run the agent with its token.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {collectors.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5">
                <Server className="h-4 w-4 text-faint shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium flex items-center gap-2">{c.name} <StatusDot online={c.online} /></div>
                  <div className="text-xs text-faint">{c.online ? "online" : `last seen ${fmtRelTime(c.last_seen_at)}`}</div>
                </div>
                <button className="btn-ghost py-1.5 px-2" title="Rotate token" onClick={() => rotate.mutate(c.id)}><RefreshCw className="h-4 w-4" /></button>
                <button className="btn-danger py-1.5 px-2" onClick={() => confirm(`Delete collector ${c.name}? Its data is removed.`) && del.mutate(c.id)}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TokenReveal({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 bg-base/60 rounded-lg px-3 py-2 text-xs font-mono break-all">{token}</code>
      <button
        className="btn-ghost py-2 px-2.5 shrink-0"
        onClick={() => {
          navigator.clipboard.writeText(token);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4 text-good" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function AccountSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mut = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setMsg({ ok: true, text: "Password updated" });
      setCurrent("");
      setNext("");
    },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });

  return (
    <section>
      <SectionTitle>Account</SectionTitle>
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input type="password" className="input" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input type="password" className="input" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={!current || next.length < 4 || mut.isPending} onClick={() => mut.mutate()}>
            <KeyRound className="h-4 w-4" /> Change password
          </button>
          {msg && <span className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
        </div>
      </div>
    </section>
  );
}
