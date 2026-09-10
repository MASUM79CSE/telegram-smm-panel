"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Shared URL-query-string pagination control for admin list pages
 * (docs/DASHBOARD_UPGRADE_PLAN.md §2.4). Pairs with `AdminFilterBar` — both
 * only ever edit the `?page=&limit=&...` query string; the server
 * component page itself does the actual data fetch on each navigation.
 */
export function AdminPagination({ page, totalPages, total }: { page: number; totalPages: number; total: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (totalPages <= 1) return null;

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  }

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
      <span>
        Page {page} of {totalPages} ({total} total)
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => goToPage(Math.max(1, page - 1))}
          disabled={page === 1 || isPending}
          className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={() => goToPage(Math.min(totalPages, page + 1))}
          disabled={page === totalPages || isPending}
          className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
