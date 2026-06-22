import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  Activity, Bell, LayoutGrid, Settings as SettingsIcon, Menu, X, LogOut, Search, Server,
  ChevronRight, Folder, FolderOpen,
} from "lucide-react";
import type { Target } from "@mping/shared";
import { api } from "../lib/api.js";
import { UIProvider } from "../state/ui.js";
import { TopBar } from "./TopBar.js";
import { Skeleton } from "./ui.js";
import {
  ancestorPaths, buildTree, countTargets, sortedChildren, sortedTargets, type TreeNode,
} from "../lib/groupTree.js";

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const qc = useQueryClient();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data: targets, isLoading } = useQuery({ queryKey: ["targets"], queryFn: api.listTargets });
  const { data: collectors } = useQuery({ queryKey: ["collectors"], queryFn: api.listCollectors });

  const allTargets = targets ?? [];
  const searching = q.trim().length > 0;
  const ql = q.toLowerCase();

  // Filter targets, then build the group tree from what's left.
  const filtered = useMemo(
    () =>
      searching
        ? allTargets.filter((t) => t.name.toLowerCase().includes(ql) || t.host.toLowerCase().includes(ql))
        : allTargets,
    [allTargets, searching, ql],
  );
  const tree = useMemo(() => buildTree(filtered), [filtered]);

  // Auto-expand the branch of the target being viewed (covers deep links).
  const activeId = Number(/^\/targets\/(\d+)/.exec(location.pathname)?.[1] ?? NaN);
  const lastExpandedId = useRef<number | null>(null);
  useEffect(() => {
    if (!Number.isFinite(activeId)) return;
    if (lastExpandedId.current === activeId) return;
    const target = allTargets.find((t) => t.id === activeId);
    if (!target) return;
    const paths = ancestorPaths(target.group_name);
    lastExpandedId.current = activeId;
    if (paths.length) setExpanded((prev) => new Set([...prev, ...paths]));
  }, [activeId, allTargets]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border/60">
        <div className="h-8 w-8 rounded-lg bg-accent/15 grid place-items-center">
          <Activity className="h-5 w-5 text-accent-soft" />
        </div>
        <span className="font-bold text-lg tracking-tight">mping</span>
      </div>

      <nav className="px-3 py-3 space-y-1">
        <NavItem to="/" icon={<LayoutGrid className="h-4 w-4" />} label="Dashboard" onNavigate={onNavigate} end />
        <NavItem to="/alerts" icon={<Bell className="h-4 w-4" />} label="Alerts" onNavigate={onNavigate} />
        <NavItem to="/settings" icon={<SettingsIcon className="h-4 w-4" />} label="Settings" onNavigate={onNavigate} />
      </nav>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search probes…"
            className="input pl-9 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {isLoading ? (
          <div className="space-y-2 px-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-faint px-2 py-4 text-center">
            {searching ? "No matches" : "No probes yet"}
          </p>
        ) : (
          <div className="space-y-0.5">
            {/* Ungrouped targets at the root */}
            {sortedTargets(tree.targets).map((t) => (
              <TargetLink key={t.id} target={t} activeId={activeId} depth={0} onNavigate={onNavigate} />
            ))}
            {/* Group subtree */}
            {sortedChildren(tree).map((node) => (
              <GroupNode
                key={node.path}
                node={node}
                depth={0}
                activeId={activeId}
                expanded={expanded}
                toggle={toggle}
                forceOpen={searching}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border/60 flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-2">
          <Server className="h-3.5 w-3.5" />
          {(collectors ?? []).filter((c) => c.online).length}/{collectors?.length ?? 0} collectors
        </span>
        <button
          onClick={async () => {
            await api.logout();
            qc.invalidateQueries({ queryKey: ["me"] });
          }}
          className="flex items-center gap-1.5 hover:text-gray-200 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </div>
  );
}

function GroupNode({
  node,
  depth,
  activeId,
  expanded,
  toggle,
  forceOpen,
  onNavigate,
}: {
  node: TreeNode;
  depth: number;
  activeId: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  forceOpen: boolean;
  onNavigate?: () => void;
}) {
  const open = forceOpen || expanded.has(node.path);
  return (
    <div>
      <button
        onClick={() => toggle(node.path)}
        className="w-full flex items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm font-medium text-gray-300 hover:bg-surface-2 transition-colors"
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        <ChevronRight className={clsx("h-3.5 w-3.5 text-faint shrink-0 transition-transform", open && "rotate-90")} />
        {open ? (
          <FolderOpen className="h-4 w-4 text-accent-soft/80 shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-faint shrink-0" />
        )}
        <span className="truncate flex-1 text-left">{node.name}</span>
        <span className="text-[11px] text-faint tabular-nums">{countTargets(node)}</span>
      </button>
      {open && (
        <div>
          {sortedChildren(node).map((child) => (
            <GroupNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              expanded={expanded}
              toggle={toggle}
              forceOpen={forceOpen}
              onNavigate={onNavigate}
            />
          ))}
          {sortedTargets(node.targets).map((t) => (
            <TargetLink key={t.id} target={t} activeId={activeId} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function TargetLink({
  target,
  activeId,
  depth,
  onNavigate,
}: {
  target: Target;
  activeId: number;
  depth: number;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={`/targets/${target.id}`}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          "flex items-center justify-between gap-2 rounded-lg py-2 pr-2.5 text-sm transition-colors",
          isActive || target.id === activeId ? "bg-accent/15 text-white" : "text-gray-300 hover:bg-surface-2",
        )
      }
      style={{ paddingLeft: depth * 14 + 8 }}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", target.enabled ? "bg-accent" : "bg-faint")} />
        <span className="truncate">{target.name}</span>
      </span>
      <span className="text-[11px] font-mono shrink-0 text-faint">{target.host}</span>
    </NavLink>
  );
}

function NavItem({
  to,
  icon,
  label,
  onNavigate,
  end,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  onNavigate?: () => void;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive ? "bg-accent/15 text-white shadow-glow" : "text-gray-300 hover:bg-surface-2",
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <UIProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-72 shrink-0 border-r border-border/60 bg-surface/60 backdrop-blur-xl">
          <Sidebar />
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="lg:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
            <aside className="absolute left-0 top-0 bottom-0 w-72 bg-surface border-r border-border/60">
              <Sidebar onNavigate={() => setDrawerOpen(false)} />
            </aside>
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 shrink-0 border-b border-border/60 bg-surface/40 backdrop-blur-xl flex items-center gap-3 px-4">
            <button
              className="lg:hidden btn-ghost px-2 py-2"
              onClick={() => setDrawerOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {drawerOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <TopBar />
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </UIProvider>
  );
}
