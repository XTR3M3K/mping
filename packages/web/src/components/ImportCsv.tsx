import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Upload } from "lucide-react";
import { clsx } from "clsx";
import { probeLabel, type TargetImportResult } from "@mping/shared";
import { api } from "../lib/api.js";
import { CSV_TEMPLATE, csvToTargets, parseCsv, type CsvParseResult } from "../lib/csv.js";
import { Modal } from "./Modal.js";
import { Chip } from "./ui.js";

const PREVIEW_ROWS = 8;

export function ImportCsv({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [result, setResult] = useState<TargetImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed: CsvParseResult | null = useMemo(
    () => (text.trim() === "" ? null : csvToTargets(parseCsv(text))),
    [text],
  );

  const importMut = useMutation({
    mutationFn: () => api.importTargets(parsed!.targets, mode),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ["targets"] });
    },
  });

  const reset = () => {
    setText("");
    setResult(null);
    importMut.reset();
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setText(await file.text());
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import probes from CSV"
      footer={
        result ? (
          <>
            <button className="btn-ghost" onClick={reset}>Import another</button>
            <button className="btn-primary" onClick={close}>Done</button>
          </>
        ) : (
          <>
            <button className="btn-ghost" onClick={close}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!parsed?.targets.length || importMut.isPending}
              onClick={() => importMut.mutate()}
            >
              <Upload className="h-4 w-4" />
              {importMut.isPending
                ? "Importing…"
                : `Import ${parsed?.targets.length ?? 0} probe${parsed?.targets.length === 1 ? "" : "s"}`}
            </button>
          </>
        )
      }
    >
      {result ? (
        <ImportSummary result={result} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <FileUp className="h-4 w-4" /> Choose file
            </button>
            <a className="btn-ghost" href={templateHref()} download="mping-probes.csv">
              <Download className="h-4 w-4" /> Example file
            </a>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
          </div>

          <label className="block">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="label">…or paste the file</span>
              <span className="text-[10px] text-faint">name and host required, the rest optional</span>
            </div>
            <textarea
              className="input font-mono text-xs h-28 resize-y"
              spellCheck={false}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setResult(null);
              }}
              placeholder={"name,host,type,group_name,interval_sec\nCloudflare,1.1.1.1,ping,EMEA,60"}
            />
          </label>

          {parsed && <Preview parsed={parsed} mode={mode} onMode={setMode} />}

          {importMut.error && <p className="text-sm text-bad">{(importMut.error as Error).message}</p>}
        </div>
      )}
    </Modal>
  );
}

function templateHref(): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;
}

function Preview({
  parsed,
  mode,
  onMode,
}: {
  parsed: CsvParseResult;
  mode: "skip" | "update";
  onMode: (m: "skip" | "update") => void;
}) {
  const { targets, issues, unknownColumns } = parsed;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={targets.length ? "good" : "neutral"}>{targets.length} ready</Chip>
        {issues.length > 0 && <Chip tone="bad">{issues.length} skipped</Chip>}
        {unknownColumns.length > 0 && <Chip tone="warn">ignoring: {unknownColumns.join(", ")}</Chip>}
      </div>

      {issues.length > 0 && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-3 max-h-32 overflow-y-auto space-y-1">
          {issues.map((issue, i) => (
            <div key={i} className="text-xs">
              <span className="text-faint font-mono">line {issue.line}</span>{" "}
              <span className="text-bad">{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      {targets.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-faint text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Name</th>
                  <th className="text-left font-medium px-3 py-2">Host</th>
                  <th className="text-left font-medium px-3 py-2 w-20">Type</th>
                  <th className="text-left font-medium px-3 py-2">Group</th>
                </tr>
              </thead>
              <tbody>
                {targets.slice(0, PREVIEW_ROWS).map((t, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="px-3 py-1.5 truncate max-w-[10rem]">{t.name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs truncate max-w-[12rem]">
                      {t.host}
                      {t.port != null && t.type !== "ping" && <span className="text-faint">:{t.port}</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <Chip tone={(t.type ?? "ping") === "ping" ? "neutral" : "accent"}>
                        {probeLabel(t.type ?? "ping")}
                      </Chip>
                    </td>
                    <td className="px-3 py-1.5 text-muted truncate max-w-[10rem]">{t.group_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {targets.length > PREVIEW_ROWS && (
            <p className="text-xs text-faint">…and {targets.length - PREVIEW_ROWS} more.</p>
          )}

          <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-surface-2/40 p-3">
            <div>
              <div className="text-sm font-medium">A probe with the same name exists</div>
              <div className="text-xs text-faint">
                {mode === "skip" ? "Leave it as it is." : "Overwrite it with the row from the file."}
              </div>
            </div>
            <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-0.5 border border-border shrink-0">
              {(["skip", "update"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onMode(m)}
                  className={clsx(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                    mode === m ? "bg-accent text-white" : "text-muted hover:text-gray-200",
                  )}
                >
                  {m === "skip" ? "Skip" : "Update"}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ImportSummary({ result }: { result: TargetImportResult }) {
  const failed = result.rows.filter((r) => r.status === "failed");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="good">{result.created} created</Chip>
        {result.updated > 0 && <Chip tone="accent">{result.updated} updated</Chip>}
        {result.skipped > 0 && <Chip tone="neutral">{result.skipped} skipped</Chip>}
        {result.failed > 0 && <Chip tone="bad">{result.failed} failed</Chip>}
      </div>
      {result.skipped > 0 && (
        <p className="text-xs text-faint">
          Skipped rows already had a probe with that name. Re-run with “Update” to overwrite them.
        </p>
      )}
      {failed.length > 0 && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-3 max-h-40 overflow-y-auto space-y-1">
          {failed.map((r) => (
            <div key={r.index} className="text-xs">
              <span className="font-mono text-faint">{r.name}</span> <span className="text-bad">{r.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
