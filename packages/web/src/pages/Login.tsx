import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Activity, LogIn } from "lucide-react";
import { api, ApiError } from "../lib/api.js";

export function Login() {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="card w-full max-w-sm p-8"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="h-14 w-14 rounded-2xl bg-accent/15 grid place-items-center shadow-glow mb-3">
            <Activity className="h-7 w-7 text-accent-soft" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">mping</h1>
          <p className="text-sm text-muted mt-1">Sign in to your monitor</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label mb-1.5 block">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy || !password}>
            <LogIn className="h-4 w-4" />
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
