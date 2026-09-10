import { getAuditActionMeta, AUDIT_CATEGORY_COLORS } from "@/lib/audit-labels";

export interface ActivityRow {
  _id: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
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

/** Compact recent-activity list, shared by the admin overview page and (in full form) the audit-log viewer. */
export function RecentActivityFeed({ entries }: { entries: ActivityRow[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No activity yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {entries.map((e) => {
        const meta = getAuditActionMeta(e.action);
        return (
          <li key={e._id} className="flex items-start gap-3 text-sm">
            <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${AUDIT_CATEGORY_COLORS[meta.category]}`}>
              {meta.category}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-slate-200">
                <span className="text-slate-400">{e.actorEmail ?? "System"}</span> — {meta.label}
                {e.targetType && <span className="text-slate-500"> ({e.targetType})</span>}
              </p>
              <p className="text-xs text-slate-500">{timeAgo(e.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
