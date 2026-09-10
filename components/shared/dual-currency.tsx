import type { DisplayMoney } from "@/lib/services/display-money";

/**
 * Renders a primary (always-USD, always-correct) amount with an optional
 * live-converted secondary amount in the viewer's local currency (Phase 4
 * i18n/growth — see `lib/currency.ts`'s module doc for the ledger-vs-display
 * rationale). Purely presentational — the actual conversion happens
 * server-side in `lib/services/display-money.ts#getDisplayMoney`.
 */
export function DualCurrency({ money, size = "md" }: { money: DisplayMoney; size?: "sm" | "md" | "lg" }) {
  const primaryClass = size === "lg" ? "text-2xl font-bold" : size === "sm" ? "text-sm font-medium" : "font-semibold";

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={primaryClass}>{money.primary}</span>
      {money.secondary && <span className="text-xs font-normal text-slate-500">≈ {money.secondary}</span>}
    </span>
  );
}
