import { Schema, model, models, Model } from "mongoose";

/**
 * Singleton document (one row, like `Settings`) caching the latest USD-base
 * exchange rates fetched from the live FX-rate API (see `lib/currency.ts`).
 *
 * Why DB-backed rather than an in-memory module-level cache: this app runs
 * on serverless/multi-instance deployments (same reasoning already applied
 * to `lib/rate-limit.ts`'s Upstash-backed limiter) — an in-memory cache
 * would be refetched independently, and inconsistently, by every cold
 * instance, defeating both the "cache for a day" intent and the upstream
 * API's own rate-limit guidance (their docs: refresh at most once/hour,
 * ideally once/day, since the underlying data itself only updates daily).
 *
 * This is DISPLAY-only data. The ledger (`Wallet.balance`, `Order.charge`,
 * `Transaction.amount`, etc.) remains stored and computed exclusively in
 * USD — nothing here is ever written back into a money-bearing field. See
 * `lib/currency.ts`'s module doc comment for the full rationale.
 */
export interface IExchangeRateCache {
  key: "latest";
  /** Base currency the rates are relative to — always "USD" for this app's ledger. */
  base: string;
  /** ISO 4217 code -> rate (1 base unit = `rate` units of that currency). */
  rates: Record<string, number>;
  /** When this app last successfully fetched from the upstream API. */
  fetchedAt: Date;
  /** Upstream's own "next scheduled update" timestamp, if provided — informational only. */
  upstreamNextUpdateAt: Date | null;
}

const exchangeRateCacheSchema = new Schema<IExchangeRateCache>(
  {
    key: { type: String, default: "latest", unique: true },
    base: { type: String, default: "USD" },
    rates: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true },
    upstreamNextUpdateAt: { type: Date, default: null },
  },
  { timestamps: false }
);

export const ExchangeRateCache: Model<IExchangeRateCache> =
  models.ExchangeRateCache || model<IExchangeRateCache>("ExchangeRateCache", exchangeRateCacheSchema);
