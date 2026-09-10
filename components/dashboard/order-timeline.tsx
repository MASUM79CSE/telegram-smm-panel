"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/dashboard/status-badge";

export interface TimelineEvent {
  status: string;
  statusLabel: string;
  note: string | null;
  at: string;
}

/**
 * Expand/collapse toggle rendering `Order.statusHistory` as a vertical
 * stepper — that field has been written on every order transition since
 * Phase 1 but was never rendered anywhere in the UI until now
 * (docs/DASHBOARD_UPGRADE_PLAN.md §3.1).
 *
 * `statusLabel` is resolved server-side per event (not passed as a function
 * prop) because this is a client component and functions cannot cross the
 * server/client boundary.
 */
export function OrderTimelineToggle({
  events,
  toggleLabel,
}: {
  events: TimelineEvent[];
  toggleLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-blue-400 hover:underline"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {toggleLabel}
      </button>

      {open && (
        <ol className="mt-3 space-y-3 border-l border-slate-800 pl-4">
          {events.map((e, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-blue-500" />
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={e.status} label={e.statusLabel} />
                <span className="text-xs text-slate-500">{new Date(e.at).toLocaleString()}</span>
              </div>
              {e.note && <p className="mt-1 text-xs text-slate-400">{e.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
