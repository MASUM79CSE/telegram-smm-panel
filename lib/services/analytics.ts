import { Types } from "mongoose";
import { Order } from "@/models/Order";
import { Transaction } from "@/models/Transaction";
import { User } from "@/models/User";
import { Service } from "@/models/Service";
import { Provider } from "@/models/Provider";
import { decimalToNumber } from "@/lib/money";

/**
 * Small, purpose-built Mongo aggregation helpers for the admin/customer
 * dashboard analytics views (docs/DASHBOARD_UPGRADE_PLAN.md §1.2).
 * Deliberately NOT a generic reporting engine — each function here backs
 * exactly one dashboard widget. All money values are converted to plain
 * `number` via `decimalToNumber()` before being returned, since chart data
 * only needs display-safe arithmetic, never currency-safe ledger math (the
 * actual ledger writes always go through `lib/money.ts`'s Decimal128
 * helpers elsewhere — nothing here mutates any data).
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
function fillSeries(days: number, points: { _id: string; value: number }[]): DaySeriesPoint[] {
  const map = new Map(points.map((p) => [p._id, p.value]));
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

  const [revenueAgg, orderAgg, previousRevenueAgg] = await Promise.all([
    Transaction.aggregate<{ _id: string; value: number }>([
      { $match: { type: "ORDER_PAYMENT", status: "COMPLETED", createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          value: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]),
    Order.aggregate<{ _id: string; value: number }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          value: { $sum: 1 },
        },
      },
    ]),
    Transaction.aggregate<{ total: number }>([
      {
        $match: {
          type: "ORDER_PAYMENT",
          status: "COMPLETED",
          createdAt: { $gte: previousSince, $lt: since },
        },
      },
      { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } },
    ]),
  ]);

  const revenue = fillSeries(days, revenueAgg);
  const orderCount = fillSeries(days, orderAgg);
  const totalRevenue = revenue.reduce((sum, p) => sum + p.value, 0);
  const totalOrders = orderCount.reduce((sum, p) => sum + p.value, 0);
  const previousTotal = previousRevenueAgg[0]?.total ?? 0;
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

  const agg = await User.aggregate<{ _id: string; value: number }>([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        value: { $sum: 1 },
      },
    },
  ]);

  const signups = fillSeries(days, agg);
  return { signups, totalSignups: signups.reduce((sum, p) => sum + p.value, 0) };
}

export interface OrderStatusCount {
  status: string;
  count: number;
}

/** Count of orders per status, all-time — feeds a donut/bar breakdown chart. */
export async function getOrderStatusBreakdown(): Promise<OrderStatusCount[]> {
  const agg = await Order.aggregate<{ _id: string; count: number }>([
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return agg.map((a) => ({ status: a._id, count: a.count }));
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

  const agg = await Order.aggregate<{ _id: Types.ObjectId; orderCount: number; revenue: number; name: string }>([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: "$serviceId",
        orderCount: { $sum: 1 },
        revenue: { $sum: { $toDouble: "$charge" } },
      },
    },
    { $sort: { orderCount: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: Service.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "service",
      },
    },
    { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
    { $addFields: { name: { $ifNull: ["$service.name", "(deleted service)"] } } },
  ]);

  return agg.map((a) => ({
    serviceId: a._id.toString(),
    name: a.name,
    orderCount: a.orderCount,
    revenue: a.revenue,
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
  const providers = await Provider.find().lean();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const results = await Promise.all(
    providers.map(async (p) => {
      const [ordersLast24h, lastErrorOrder] = await Promise.all([
        Order.countDocuments({ providerId: p._id, createdAt: { $gte: since24h } }),
        Order.findOne({ providerId: p._id, lastError: { $ne: null } })
          .sort({ lastAttemptAt: -1 })
          .select("lastError lastAttemptAt")
          .lean(),
      ]);

      return {
        providerId: p._id.toString(),
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

  const [revenueAgg, orderAgg, refundAgg, depositAgg] = await Promise.all([
    Transaction.aggregate<{ _id: string; value: number }>([
      { $match: { type: "ORDER_PAYMENT", status: "COMPLETED", createdAt: { $gte: from, $lte: endOfTo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          value: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]),
    Order.aggregate<{ _id: string; value: number }>([
      { $match: { createdAt: { $gte: from, $lte: endOfTo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          value: { $sum: 1 },
        },
      },
    ]),
    Transaction.aggregate<{ _id: string; value: number }>([
      { $match: { type: "ORDER_REFUND", status: "COMPLETED", createdAt: { $gte: from, $lte: endOfTo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          value: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]),
    Transaction.aggregate<{ total: number }>([
      { $match: { type: "DEPOSIT", status: "COMPLETED", createdAt: { $gte: from, $lte: endOfTo } } },
      { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } },
    ]),
  ]);

  const revenueMap = new Map(revenueAgg.map((p) => [p._id, p.value]));
  const orderMap = new Map(orderAgg.map((p) => [p._id, p.value]));
  const refundMap = new Map(refundAgg.map((p) => [p._id, p.value]));

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
    totalDeposits: depositAgg[0]?.total ?? 0,
  };
}

export interface UserSpendingSeries {
  spending: DaySeriesPoint[];
  totalSpending: number;
}

/** Per-user analog of getRevenueSeries, for the customer dashboard's "Spending Insights" card. */
export async function getUserSpendingSeries(userId: string, days: number): Promise<UserSpendingSeries> {
  const since = daysAgo(days);

  const agg = await Transaction.aggregate<{ _id: string; value: number }>([
    {
      $match: {
        userId: new Types.ObjectId(userId),
        type: "ORDER_PAYMENT",
        status: "COMPLETED",
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        value: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  const spending = fillSeries(days, agg);
  return { spending, totalSpending: spending.reduce((sum, p) => sum + p.value, 0) };
}

/** Re-exported for convenience at call sites that already have a Decimal128 and want a plain number. */
export { decimalToNumber };
