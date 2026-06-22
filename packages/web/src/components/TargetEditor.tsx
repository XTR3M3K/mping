import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Target, TargetCreate } from "@mping/shared";
import { api } from "../lib/api.js";
import { Modal } from "./Modal.js";

type FormState = {
  name: string;
  host: string;
  group_name: string;
  interval_sec: number;
  ping_count: number;
  packet_size: number;
  latency_threshold_ms: string;
  alert_on_loss_pct: string;
  traceroute_enabled: boolean;
  traceroute_interval_sec: number;
  discord_webhook_url: string;
  enabled: boolean;
};

function toForm(t?: Target): FormState {
  return {
    name: t?.name ?? "",
    host: t?.host ?? "",
    group_name: t?.group_name ?? "",
    interval_sec: t?.interval_sec ?? 60,
    ping_count: t?.ping_count ?? 20,
    packet_size: t?.packet_size ?? 56,
    latency_threshold_ms: t?.latency_threshold_ms != null ? String(t.latency_threshold_ms) : "",
    alert_on_loss_pct: t?.alert_on_loss_pct != null ? String(t.alert_on_loss_pct) : "",
    traceroute_enabled: t?.traceroute_enabled ?? true,
    traceroute_interval_sec: t?.traceroute_interval_sec ?? 300,
    discord_webhook_url: t?.discord_webhook_url ?? "",
    enabled: t?.enabled ?? true,
  };
}

function toPayload(f: FormState): TargetCreate {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    name: f.name.trim(),
    host: f.host.trim(),
    group_name: f.group_name.trim() || null,
    interval_sec: f.interval_sec,
    ping_count: f.ping_count,
    packet_size: f.packet_size,
    latency_threshold_ms: num(f.latency_threshold_ms),
    alert_on_loss_pct: num(f.alert_on_loss_pct),
    traceroute_enabled: f.traceroute_enabled,
    traceroute_interval_sec: f.traceroute_interval_sec,
    discord_webhook_url: f.discord_webhook_url.trim() || null,
    enabled: f.enabled,
  };
}

export function TargetEditor({ open, onClose, target }: { open: boolean; onClose: () => void; target?: Target }) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(() => toForm(target));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  // Reset form when a different target is opened.
  const [lastId, setLastId] = useState(target?.id);
  if (open && target?.id !== lastId) {
    setLastId(target?.id);
    setF(toForm(target));
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = toPayload(f);
      if (!payload.name || !payload.host) throw new Error("Name and host are required");
      return target ? api.updateTarget(target.id, payload) : api.createTarget(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["targets"] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={target ? `Edit ${target.name}` : "New probe"}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save probe"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Cloudflare DNS" />
          </Field>
          <Field label="Group" hint="/ = subgroup">
            <input className="input" value={f.group_name} onChange={(e) => set("group_name", e.target.value)} placeholder="EMEA/Backbone" />
          </Field>
        </div>
        <Field label="Host / IP">
          <input className="input font-mono" value={f.host} onChange={(e) => set("host", e.target.value)} placeholder="1.1.1.1" />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Interval (s)">
            <input type="number" min={5} className="input" value={f.interval_sec} onChange={(e) => set("interval_sec", Number(e.target.value))} />
          </Field>
          <Field label="Pings / cycle">
            <input type="number" min={1} max={100} className="input" value={f.ping_count} onChange={(e) => set("ping_count", Number(e.target.value))} />
          </Field>
          <Field label="Packet size">
            <input type="number" min={16} className="input" value={f.packet_size} onChange={(e) => set("packet_size", Number(e.target.value))} />
          </Field>
        </div>

        <div className="rounded-xl border border-border/60 bg-surface-2/40 p-3 space-y-3">
          <div className="label">Discord alerts (ping only)</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latency threshold (ms)" hint="blank = use default">
              <input type="number" className="input" value={f.latency_threshold_ms} onChange={(e) => set("latency_threshold_ms", e.target.value)} placeholder="80" />
            </Field>
            <Field label="Loss threshold (%)" hint="blank = use default">
              <input type="number" className="input" value={f.alert_on_loss_pct} onChange={(e) => set("alert_on_loss_pct", e.target.value)} placeholder="20" />
            </Field>
          </div>
          <Field label="Webhook override" hint="blank = use global webhook">
            <input className="input font-mono text-xs" value={f.discord_webhook_url} onChange={(e) => set("discord_webhook_url", e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-surface-2/40 p-3">
          <div>
            <div className="font-medium text-sm">Traceroute</div>
            <div className="text-xs text-faint">Track path + alert on route change</div>
          </div>
          <div className="flex items-center gap-3">
            {f.traceroute_enabled && (
              <input type="number" min={30} className="input w-24 py-1.5" value={f.traceroute_interval_sec} onChange={(e) => set("traceroute_interval_sec", Number(e.target.value))} title="interval (s)" />
            )}
            <Toggle checked={f.traceroute_enabled} onChange={(v) => set("traceroute_enabled", v)} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Enabled</span>
          <Toggle checked={f.enabled} onChange={(v) => set("enabled", v)} />
        </div>

        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="label">{label}</span>
        {hint && <span className="text-[10px] text-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-accent" : "bg-surface-3"}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}
