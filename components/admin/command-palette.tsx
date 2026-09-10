"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Tags,
  Package,
  ShoppingCart,
  CreditCard,
  Server,
  Headphones,
  Settings,
  Layers,
  ScrollText,
  BarChart3,
  Search,
  Loader2,
} from "lucide-react";

const SECTIONS = [
  { title: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { title: "Reports", href: "/admin/reports", icon: BarChart3 },
  { title: "Users", href: "/admin/users", icon: Users },
  { title: "Service Groups", href: "/admin/service-groups", icon: Layers },
  { title: "Categories", href: "/admin/categories", icon: Tags },
  { title: "Services", href: "/admin/services", icon: Package },
  { title: "Providers", href: "/admin/providers", icon: Server },
  { title: "Orders", href: "/admin/orders", icon: ShoppingCart },
  { title: "Payments", href: "/admin/payments", icon: CreditCard },
  { title: "Support", href: "/admin/support", icon: Headphones },
  { title: "Audit Log", href: "/admin/audit-log", icon: ScrollText },
  { title: "Settings", href: "/admin/settings", icon: Settings },
];

interface SearchResults {
  users: { id: string; name: string; email: string }[];
  orders: { id: string; target: string; status: string }[];
  payments: { id: string; ref: string | null; status: string }[];
}

const EMPTY_RESULTS: SearchResults = { users: [], orders: [], payments: [] };

/**
 * Cmd/Ctrl+K quick-open palette for the admin panel
 * (docs/DASHBOARD_UPGRADE_PLAN.md §2.7). Mounted once in `AdminLayout` so
 * it's available from every admin page. Two result sources:
 *  - Static section list (client-only, no fetch — instant).
 *  - `/api/admin/search?q=` for jumping straight to a specific
 *    order/user/payment by id/email/target/reference.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults(EMPTY_RESULTS);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  // Lets other components (e.g. the header's search button) open the
  // palette without needing shared React state — simpler than lifting
  // `open` up into a context for a single boolean.
  useEffect(() => {
    function handleOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("admin-command-palette:open", handleOpenEvent);
    return () => window.removeEventListener("admin-command-palette:open", handleOpenEvent);
  }, []);

  useEffect(() => {
    if (open) {
      // Focus after the dialog mounts.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!open || trimmedQuery.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      startTransition(async () => {
        try {
          const res = await fetch(`/api/admin/search?q=${encodeURIComponent(trimmedQuery)}`, {
            signal: controller.signal,
          });
          setResults(res.ok ? await res.json() : EMPTY_RESULTS);
        } catch {
          // Aborted (query changed/palette closed) — nothing to do.
        }
      });
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmedQuery, open]);

  // Derived rather than effect-set: whenever the query becomes too short
  // to search, the remote results are simply not relevant/shown anymore.
  const effectiveResults = trimmedQuery.length < 2 ? EMPTY_RESULTS : results;

  function go(href: string) {
    close();
    router.push(href);
  }

  const filteredSections = SECTIONS.filter((s) => s.title.toLowerCase().includes(query.trim().toLowerCase()));

  if (!open) return null;

  const hasRemoteResults = effectiveResults.users.length > 0 || effectiveResults.orders.length > 0 || effectiveResults.payments.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24"
      onClick={close}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a section, order, user, or payment…"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
          {isPending && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {filteredSections.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-xs font-medium uppercase text-slate-600">Sections</p>
              {filteredSections.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.href}
                    onClick={() => go(s.href)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-900"
                  >
                    <Icon className="h-4 w-4 text-slate-500" />
                    {s.title}
                  </button>
                );
              })}
            </div>
          )}

          {effectiveResults.users.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-xs font-medium uppercase text-slate-600">Users</p>
              {effectiveResults.users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => go(`/admin/users?search=${encodeURIComponent(u.email)}`)}
                  className="flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-900"
                >
                  <span className="text-slate-200">{u.name}</span>
                  <span className="text-xs text-slate-500">{u.email}</span>
                </button>
              ))}
            </div>
          )}

          {effectiveResults.orders.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-xs font-medium uppercase text-slate-600">Orders</p>
              {effectiveResults.orders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => go(`/admin/orders?search=${encodeURIComponent(o.target)}`)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-900"
                >
                  <span className="truncate text-slate-200">{o.target}</span>
                  <span className="ml-2 shrink-0 text-xs text-slate-500">{o.status}</span>
                </button>
              ))}
            </div>
          )}

          {effectiveResults.payments.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-xs font-medium uppercase text-slate-600">Payments</p>
              {effectiveResults.payments.map((p) => (
                <button
                  key={p.id}
                  onClick={() => go(`/admin/payments?search=${encodeURIComponent(p.ref ?? "")}`)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-900"
                >
                  <span className="truncate text-slate-200">{p.ref ?? "(no reference)"}</span>
                  <span className="ml-2 shrink-0 text-xs text-slate-500">{p.status}</span>
                </button>
              ))}
            </div>
          )}

          {query.trim().length >= 2 && !isPending && !hasRemoteResults && filteredSections.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">No matches.</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2 text-xs text-slate-600">
          <span>↵ to select · Esc to close</span>
          <span>Ctrl/⌘+K</span>
        </div>
      </div>
    </div>
  );
}
