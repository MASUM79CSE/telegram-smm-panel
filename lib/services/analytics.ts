import { prisma } from "@/lib/db";
import { decimalToNumber } from "@/lib/money";

/**
 * Small, purpose-built Postgres aggregation helpers for the admin/customer
 * dashboard analytics views (docs/DASHBOARD_UPGRADE_PLAN.md §1.2).
 * Deliberately NOT a generic reporting engine — each function here backs
 * exactly one dashboard widget. All money values are converted to plain
 * `number` before being returned, since chart data only needs
 * display-safe arithmetic, never currency-safe ledger math (the actual
 * ledger writes always go through `lib/money.ts`'s Decimal helpers
 * elsewhere — nothing here mutates any data).
 *
 * This is the Postgres/Prisma-era rewrite of the original MongoDB
 * aggregation-pipeline version of this file. Prisma's `groupBy` cannot
 * group by a *transformed* column (e.g. "day truncated from a timestamp"),
 * so the day-bucketed queries here use `prisma.$queryRaw` with Postgres's
 * native `date_trunc`/`to_char` instead — still fully parameterized via
 * `Prisma.sql`/tagged templates, so there is no raw string interpolation
 * of caller-controlled values anywhere in this file.
 */

export interface DaySeriesPoint {
  date: string; // "YYYY-MM-DD"
  value: number;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}

/** Fills in zero-value days so charts don't show gaps for days with no activity. */
function fillSeries(days: number, points: { day: string; value: number }[]): DaySeriesPoint[] {
  const map = new Map(points.map((p) => [p.day, p.value]));
  const result: DaySeriesPoint[] = [];
  const start = daysAgo(days);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, value: map.get(key) ?? 0 });
  }
  return result;
}

interface DayValueRow {
  day: string;
  value: number | string | null;
}

export interface RevenueSeries {
  revenue: DaySeriesPoint[];
  orderCount: DaySeriesPoint[];
  totalRevenue: number;
  totalOrders: number;
  /** % change in total revenue vs. the previous equal-length period, or null if the previous period had zero revenue. */
  revenueChangePct: number | null;
}

/** Daily revenue (completed ORDER_PAYMENT transactions) + daily order count, for the last `days` days. */
export async function getRevenueSeries(days: number): Promise<RevenueSeries> {
  const since = daysAgo(days);
  const previousSince = daysAgo(days * 2);

  const [revenueRows, orderRows, previousRevenueRows] = await Promise.all([
    prisma.$queryRaw<DayValueRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, SUM(amount)::float AS value
      FROM "Transaction"
      WHERE type = 'ORDER_PAYMENT' AND status = 'COMPLETED' AND "createdAt" >= ${since}
      GROUP BY 1
    `,
    prisma.$queryRaw<DayValueRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS value
      FROM "Order"
      WHERE "createdAt" >= ${since}
      GROUP BY 1
    `,
    prisma.$queryRaw<{ total: number | string | null }[]>`
      SELECT SUM(amount)::float AS total
      FROM "Transaction"
      WHERE type = 'ORDER_PAYMENT' AND status = 'COMPLETED' AND "createdAt" >= ${previousSince} AND "createdAt" < ${since}
    `,
  ]);

  const revenue = fillSeries(
    days,
    revenueRows.map((r) => ({ day: r.day, value: Number(r.value ?? 0) }))
  );
  const orderCount = fillSeries(
    days,
    orderRows.map((r) => ({ day: r.day, value: Number(r.value ?? 0) }))
  );
  const totalRevenue = revenue.reduce((sum, p) => sum + p.value, 0);
  const totalOrders = orderCount.reduce((sum, p) => sum + p.value, 0);
  const previousTotal = Number(previousRevenueRows[0]?.total ?? 0);
  const revenueChangePct = previousTotal > 0 ? ((totalRevenue - previousTotal) / previousTotal) * 100 : null;

  return { revenue, orderCount, totalRevenue, totalOrders, revenueChangePct };
}

export interface UserGrowthSeries {
  signups: DaySeriesPoint[];
  totalSignups: number;
}

/** Daily new-user signups for the last `days` days. */
export async function getUserGrowthSeries(days: number): Promise<UserGrowthSeries> {
  const since = daysAgo(days);

  const rows = await prisma.$queryRaw<DayValueRow[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS value
    FROM "User"
    WHERE "createdAt" >= ${since}
    GROUP BY 1
  `;

  const signups = fillSeries(
    days,
    rows.map((r) => ({ day: r.day, value: Number(r.value ?? 0) }))
  );
  return { signups, totalSignups: signups.reduce((sum, p) => sum + p.value, 0) };
}

export interface OrderStatusCount {
  status: string;
  count: number;
}

/** Count of orders per status, all-time — feeds a donut/bar breakdown chart. */
export async function getOrderStatusBreakdown(): Promise<OrderStatusCount[]> {
  const agg = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
    orderBy: { _count: { status: "desc" } },
  });
  return agg
    .map((a) => ({ status: a.status, count: a._count._all }))
    .sort((a, b) => b.count - a.count);
}

export interface TopService {
  serviceId: string;
  name: string;
  orderCount: number;
  revenue: number;
}

/** Top services by order count in the last `days` days (default 30), with revenue for the same window. */
export async function getTopServices(limit = 5, days = 30): Promise<TopService[]> {
  const since = daysAgo(days);

  const rows = await prisma.$queryRaw<
    { serviceId: string; orderCount: number; revenue: number; name: string | null }[]
  >`
    SELECT o."serviceId" AS "serviceId",
           COUNT(*)::int AS "orderCount",
           SUM(o.charge)::float AS revenue,
           COALESCE(s.name, '(deleted service)') AS name
    FROM "Order" o
    LEFT JOIN "Service" s ON s.id = o."serviceId"
    WHERE o."createdAt" >= ${since}
    GROUP BY o."serviceId", s.name
    ORDER BY "orderCount" DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    serviceId: r.serviceId,
    name: r.name ?? "(deleted service)",
    orderCount: r.orderCount,
    revenue: Number(r.revenue ?? 0),
  }));
}

export interface ProviderHealth {
  providerId: string;
  name: string;
  type: string;
  status: string;
  balance: string | null;
  lastBalanceSyncAt: string | null;
  balanceStale: boolean;
  ordersLast24h: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

/** Per-provider health snapshot for the admin providers page (read-only, no new sync mechanism). */
export async function getProviderHealthSummary(): Promise<ProviderHealth[]> {
  const providers = await prisma.provider.findMany();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const results = await Promise.all(
    providers.map(async (p) => {
      const [ordersLast24h, lastErrorOrder] = await Promise.all([
        prisma.order.count({ where: { providerId: p.id, createdAt: { gte: since24h } } }),
        prisma.order.findFirst({
          where: { providerId: p.id, lastError: { not: null } },
          orderBy: { lastAttemptAt: "desc" },
          select: { lastError: true, lastAttemptAt: true },
        }),
      ]);

      return {
        providerId: p.id,
        name: p.name,
        type: p.type,
        status: p.status,
        balance: p.balance,
        lastBalanceSyncAt: p.lastBalanceSyncAt ? p.lastBalanceSyncAt.toISOString() : null,
        balanceStale: !p.lastBalanceSyncAt || p.lastBalanceSyncAt < staleThreshold,
        ordersLast24h,
        lastError: lastErrorOrder?.lastError ?? null,
        lastErrorAt: lastErrorOrder?.lastAttemptAt ? lastErrorOrder.lastAttemptAt.toISOString() : null,
      };
    })
  );

  return results;
}

export interface FinancialReportRow {
  date: string; // "YYYY-MM-DD"
  revenue: number;
  orderCount: number;
  refunds: number;
}

export interface FinancialReportSummary {
  rows: FinancialReportRow[];
  totalRevenue: number;
  totalOrders: number;
  totalRefunds: number;
  totalDeposits: number;
}

/**
 * Per-day revenue/order-count/refund summary for an arbitrary `[from, to]`
 * date range (inclusive), for the admin `/admin/reports` page
 * (docs/DASHBOARD_UPGRADE_PLAN.md §2.5). Deliberately a *custom range*
 * variant rather than reusing `getRevenueSeries`'s "last N days" shape,
 * since a financial report needs to cover an arbitrary historical window
 * a user picks, not just a rolling window ending today. Rows are
 * serialized via `lib/services/financial-report.ts#toFinancialReportCsv`
 * for the CSV export routes — its `FinancialReportRow` shape is
 * structurally identical to this one by design (kept as two separate
 * exports rather than a shared import to preserve
 * `lib/services/financial-report.ts`'s existing "pure, DB-free module"
 * boundary — see that file's own doc comment).
 */
export async function getFinancialReportRows(from: Date, to: Date): Promise<FinancialReportSummary> {
  const endOfTo = new Date(to);
  endOfTo.setUTCHours(23, 59, 59, 999);

  const [revenueRows, orderRows, refundRows, depositRows] = await Promise.all([
    prisma.$queryRaw<DayValueRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, SUM(amount)::float AS value
      FROM "Transaction"
      WHERE type = 'ORDER_PAYMENT' AND status = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" <= ${endOfTo}
      GROUP BY 1
    `,
    prisma.$queryRaw<DayValueRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, COUNT(*)::int AS value
      FROM "Order"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${endOfTo}
      GROUP BY 1
    `,
    prisma.$queryRaw<DayValueRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, SUM(amount)::float AS value
      FROM "Transaction"
      WHERE type = 'ORDER_REFUND' AND status = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" <= ${endOfTo}
      GROUP BY 1
    `,
    prisma.$queryRaw<{ total: number | string | null }[]>`
      SELECT SUM(amount)::float AS total
      FROM "Transaction"
      WHERE type = 'DEPOSIT' AND status = 'COMPLETED' AND "createdAt" >= ${from} AND "createdAt" <= ${endOfTo}
    `,
  ]);

  const revenueMap = new Map(revenueRows.map((p) => [p.day, Number(p.value ?? 0)]));
  const orderMap = new Map(orderRows.map((p) => [p.day, Number(p.value ?? 0)]));
  const refundMap = new Map(refundRows.map((p) => [p.day, Number(p.value ?? 0)]));

  const days = Math.max(1, Math.round((endOfTo.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const rows: FinancialReportRow[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    rows.push({
      date: key,
      revenue: revenueMap.get(key) ?? 0,
      orderCount: orderMap.get(key) ?? 0,
      refunds: refundMap.get(key) ?? 0,
    });
  }

  return {
    rows,
    totalRevenue: rows.reduce((sum, r) => sum + r.revenue, 0),
    totalOrders: rows.reduce((sum, r) => sum + r.orderCount, 0),
    totalRefunds: rows.reduce((sum, r) => sum + r.refunds, 0),
    totalDeposits: Number(depositRows[0]?.total ?? 0),
  };
}

export interface UserSpendingSeries {
  spending: DaySeriesPoint[];
  totalSpending: number;
}

/** Per-user analog of getRevenueSeries, for the customer dashboard's "Spending Insights" card. */
export async function getUserSpendingSeries(userId: string, days: number): Promise<UserSpendingSeries> {
  const since = daysAgo(days);

  const rows = await prisma.$queryRaw<DayValueRow[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, SUM(amount)::float AS value
    FROM "Transaction"
    WHERE "userId" = ${userId} AND type = 'ORDER_PAYMENT' AND status = 'COMPLETED' AND "createdAt" >= ${since}
    GROUP BY 1
  `;

  const spending = fillSeries(
    days,
    rows.map((r) => ({ day: r.day, value: Number(r.value ?? 0) }))
  );
  return { spending, totalSpending: spending.reduce((sum, p) => sum + p.value, 0) };
}

/** Re-exported for convenience at call sites that already have a Decimal and want a plain number. */
export { decimalToNumber };
