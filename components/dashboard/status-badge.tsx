const statusColors: Record<string, string> = {
  PENDING: "bg-slate-700 text-slate-200",
  PROCESSING: "bg-amber-900 text-amber-300",
  IN_PROGRESS: "bg-blue-900 text-blue-300",
  COMPLETED: "bg-green-900 text-green-300",
  PARTIAL: "bg-orange-900 text-orange-300",
  CANCELED: "bg-slate-800 text-slate-400",
  FAILED: "bg-red-950 text-red-400",
  REFUNDED: "bg-purple-950 text-purple-300",
  OPEN: "bg-blue-900 text-blue-300",
  ANSWERED: "bg-green-900 text-green-300",
  CLOSED: "bg-slate-800 text-slate-400",
  PENDING_PAYMENT: "bg-amber-900 text-amber-300",
  COMPLETED_PAYMENT: "bg-green-900 text-green-300",
  REJECTED: "bg-red-950 text-red-400",
  ACTIVE: "bg-green-900 text-green-300",
  SUSPENDED: "bg-amber-900 text-amber-300",
  BANNED: "bg-red-950 text-red-400",
};

/**
 * Shared between `/admin/**` (deliberately English-only, no next-intl
 * provider in scope — see docs/I18N_PLAN.md §2) and the customer-facing
 * `/[locale]/dashboard/**`. Rather than calling `useTranslations` directly
 * here (which would throw outside `/[locale]`'s `<NextIntlClientProvider>`),
 * callers under `[locale]` pass an already-translated `label` (via
 * `Dashboard.status.<STATUS>`/`StatusBadge.<STATUS>` in
 * `messages/{locale}.json`); admin call sites omit it and keep the original
 * English `status.replace(/_/g, " ")` fallback.
 */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const color = statusColors[status] || "bg-slate-800 text-slate-300";
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${color}`}>
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}
