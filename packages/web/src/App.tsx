import { Routes, Route, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api.js";
import { Login } from "./pages/Login.js";
import { AppShell } from "./components/AppShell.js";
import { Dashboard } from "./pages/Dashboard.js";
import { TargetDetail } from "./pages/TargetDetail.js";
import { Alerts } from "./pages/Alerts.js";
import { Settings } from "./pages/Settings.js";
import { Spinner } from "./components/ui.js";

export default function App() {
  const { data, isLoading } = useQuery({ queryKey: ["me"], queryFn: api.me });

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Spinner />
      </div>
    );
  }

  if (!data?.authed) return <Login />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/targets/:id" element={<TargetDetail />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
