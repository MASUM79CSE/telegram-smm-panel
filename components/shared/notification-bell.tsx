"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Bell, Check } from "lucide-react";

interface NotificationItem {
  _id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Shared notification bell, used by both `DashboardHeader` (customer) and
 * `AdminHeader` (admin) — docs/DASHBOARD_UPGRADE_PLAN.md §1.3/§3.4. Polls
 * the unread count every 30s (no WebSocket/SSE infra for this project's
 * current scale — see the plan doc's explicit-scope section for why).
 *
 * `linkPrefix` lets the customer-facing (locale-prefixed) and admin
 * (unprefixed English-only) call sites resolve a notification's `href`
 * correctly without this shared component needing to know about i18n.
 */
export function NotificationBell({ linkPrefix = "" }: { linkPrefix?: string }) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?unread=true&limit=1");
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // Best-effort — a failed poll should never surface an error to the user.
    }
  }, []);

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=10");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
        setLoaded(true);
      }
    } catch {
      // Best-effort.
    }
  }, []);

  useEffect(() => {
    // Deferred via setTimeout (rather than calling the async fetcher
    // synchronously in the effect body) to satisfy the
    // `react-hooks/set-state-in-effect` rule, which flags any effect body
    // that can be traced to a setState call, even through an awaited async
    // function — same pattern already used for the debounced search in
    // `components/admin/audit-log-viewer.tsx`.
    const initial = setTimeout(fetchCount, 0);
    const interval = setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [fetchCount]);

  useEffect(() => {
    if (!open || loaded) return;
    const timeout = setTimeout(fetchRecent, 0);
    return () => clearTimeout(timeout);
  }, [open, loaded, fetchRecent]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function markOneRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    await fetch(`/api/notifications/${id}`, { method: "PATCH" }).catch(() => {});
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-blue-400 hover:underline">
                <Check className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <a
                  key={n._id}
                  href={n.href ? `${linkPrefix}${n.href}` : "#"}
                  onClick={() => !n.read && markOneRead(n._id)}
                  className={`block border-b border-slate-900 px-4 py-3 text-sm transition hover:bg-slate-900 ${
                    n.read ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-white">{n.title}</p>
                    {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                  </div>
                  <p className="mt-0.5 text-slate-400">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-600">{timeAgo(n.createdAt)}</p>
                </a>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
