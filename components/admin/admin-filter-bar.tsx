"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

export interface AdminFilterBarProps {
  /** Placeholder text for the free-text search box, e.g. "Search by target, service…". Omit to hide search. */
  searchPlaceholder?: string;
  /** Available status options for the multi-select. Omit to hide the status filter. */
  statusOptions?: string[];
}

/**
 * Shared filter UI for admin list pages (Orders/Users/Payments/Support —
 * docs/DASHBOARD_UPGRADE_PLAN.md §2.4). Persists every filter directly in
 * the URL query string via `router.push`, so a filtered view is
 * shareable/bookmarkable and survives a page refresh — the pages
 * themselves (server components) read `searchParams` and pass filtered,
 * paginated data down; this component only ever edits the URL, never
 * fetches data itself.
 */
export function AdminFilterBar({ searchPlaceholder = "Search…", statusOptions }: AdminFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const selectedStatuses = new Set((searchParams.get("status") ?? "").split(",").filter(Boolean));

  function applyParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Any filter change resets pagination back to page 1.
    params.delete("page");
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    applyParams({ search: search.trim() || null });
  }

  function toggleStatus(status: string) {
    const next = new Set(selectedStatuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    applyParams({ status: next.size > 0 ? Array.from(next).join(",") : null });
  }

  function applyDateRange() {
    applyParams({ from: from || null, to: to || null });
  }

  function clearAll() {
    setSearch("");
    setFrom("");
    setTo("");
    applyParams({ search: null, status: null, from: null, to: null });
  }

  const hasActiveFilters =
    !!searchParams.get("search") || !!searchParams.get("status") || !!searchParams.get("from") || !!searchParams.get("to");

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        {searchPlaceholder && (
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Search
            </button>
          </form>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onBlur={applyDateRange}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-blue-500"
          />
          <label className="text-xs text-slate-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={applyDateRange}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-blue-500"
          />
        </div>

        {isPending && <span className="text-xs text-slate-500">Loading…</span>}

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
          >
            <X className="h-3 w-3" />
            Clear filters
          </button>
        )}
      </div>

      {statusOptions && statusOptions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {statusOptions.map((status) => {
            const active = selectedStatuses.has(status);
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-blue-600 bg-blue-950 text-blue-300"
                    : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                }`}
              >
                {status.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
