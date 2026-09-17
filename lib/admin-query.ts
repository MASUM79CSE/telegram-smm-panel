/**
 * Small, shared query-parsing helpers for admin list pages/routes
 * (docs/DASHBOARD_UPGRADE_PLAN.md §2.4 — Advanced filters & search). Kept
 * deliberately tiny and dependency-free so both server components
 * (the admin list pages under app/admin, which query Mongoose directly)
 * and the parallel /api/admin list routes can share identical filter
 * semantics without duplicating parsing logic.
 */

/** Comma-separated multi-value query param (e.g. `?status=PENDING,FAILED`) -> string[], or undefined if empty/absent. */
export function parseStatusList(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/**
 * Inclusive `[from, to]` date range for a `createdAt`-style field. `to` is
 * extended to end-of-day. Keys are Prisma's own filter shape (`gte`/`lte`)
 * — was `$gte`/`$lte` (MongoDB) before this migration; every caller passes
 * this straight into a Prisma `where` clause.
 */
export function parseDateRange(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined
): { gte?: Date; lte?: Date } | undefined {
  const range: { gte?: Date; lte?: Date } = {};

  if (fromRaw) {
    const from = new Date(fromRaw);
    if (!Number.isNaN(from.getTime())) range.gte = from;
  }

  if (toRaw) {
    const to = new Date(toRaw);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      range.lte = to;
    }
  }

  return Object.keys(range).length > 0 ? range : undefined;
}

/** Escapes user-supplied text for safe use inside a MongoDB `$regex` (prevents regex-injection/ReDoS from unescaped metacharacters). */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ParsedListQuery {
  page: number;
  limit: number;
  status?: string[];
  search?: string;
  dateRange?: { gte?: Date; lte?: Date };
}

/** Parses the common `page`/`limit`/`status`/`search`/`from`/`to` shape shared by every admin list page/route. */
export function parseListQuery(searchParams: URLSearchParams, defaultLimit = 20, maxLimit = 100): ParsedListQuery {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(searchParams.get("limit") || String(defaultLimit), 10) || defaultLimit));
  const status = parseStatusList(searchParams.get("status"));
  const search = searchParams.get("search")?.trim() || undefined;
  const dateRange = parseDateRange(searchParams.get("from"), searchParams.get("to"));

  return { page, limit, status, search, dateRange };
}
