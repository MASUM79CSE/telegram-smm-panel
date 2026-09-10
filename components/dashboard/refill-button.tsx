"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * Self-service "Request Refill" button (docs/IMPLEMENTATION_PLAN.md Phase
 * 3.1), shown only on eligible COMPLETED orders — the eligibility check
 * itself lives server-side in `app/dashboard/orders/page.tsx` (mirroring
 * `refill.ts#requestRefill`'s own checks); this component just triggers the
 * request and reflects the result, the way `components/admin/orders-table.tsx`
 * triggers admin status changes.
 */
export function RefillButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const t = useTranslations("Dashboard.orders");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!confirm(t("refillConfirm"))) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/orders/${orderId}/refill`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("refillErrorFallback"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isPending}
        className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? t("requestingRefill") : t("requestRefill")}
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
