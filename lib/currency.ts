import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import type { DisplayCurrency } from "@/lib/currency-format";
import { logger } from "@/lib/logger";

/**
 * Live currency-DISPLAY conversion (Phase 4 i18n/growth follow-up). Server
 * -only (imports `connectDB`/Mongoose) — see `lib/currency-format.ts` for
 * the client-safe formatting helpers this module re-exports for
 * convenience, so most server call sites only need this one import.
 *
 * Ground rule (unchanged, carried over from `lib/money.ts`'s own doc
 * comment and this project's established convention): USD remains the one
 * and only ledger currency. `Wallet.balance`, `Order.charge`,
 * `Transaction.amount`, `Payment.amount`'s underlying value, etc. are never
 * converted, mutated, or re-denominated by anything in this file — this
 * module ONLY produces a number/string for on-screen display, e.g. showing
 * a Bengali (`bn`) user their $12.50 USD balance as a live-computed
 * "৳1,534.20" alongside (or instead of) the canonical "$12.50", without
 * ever writing a BDT value anywhere near the database.
 *
 * Rate source: the free, keyless "Open Access" endpoint of
 * exchangerate-api.com (https://open.er-api.com/v6/latest/USD) — updates
 * once per day, no API key required. Per that service's terms
 * (https://www.exchangerate-api.com/docs/free): caching the response is
 * explicitly permitted and expected (their own guidance: refetching more
 * than once/hour gains nothing since the underlying data itself only
 * refreshes daily, and can get an IP rate-limited), and attribution is
 * required wherever the rates are shown — see `ATTRIBUTION_TEXT`/
 * `ATTRIBUTION_URL` (re-exported from `lib/currency-format.ts`), surfaced
 * in the UI next to any converted amount.
 *
 * Caching: a single DB row (`ExchangeRateCache`, mirroring the existing
 * `Settings` singleton-document pattern) rather than an in-memory module
 * cache, for the same reason `lib/rate-limit.ts` uses Upstash Redis instead
 * of an in-memory Map for its "real" path — this app can run as multiple
 * serverless instances that don't share process memory, so an in-memory
 * cache would be refetched independently (and inconsistently) by every
 * cold instance.
 */
export {
  DISPLAY_CURRENCIES,
  formatCurrencyAmount,
  defaultDisplayCurrencyForLocale,
  ATTRIBUTION_TEXT,
  ATTRIBUTION_URL,
  type DisplayCurrency,
} from "@/lib/currency-format";

const UPSTREAM_URL = "https://open.er-api.com/v6/latest/USD";
/** Refresh at most this often — well within upstream's daily update cadence and documented rate-limit guidance. */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface RatesSnapshot {
  base: "USD";
  rates: Record<string, number>;
  fetchedAt: Date;
}

async function fetchLiveRates(): Promise<RatesSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(UPSTREAM_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`FX API returned HTTP ${res.status}`);
    const data = await res.json();
    if (data.result !== "success" || !data.rates) {
      throw new Error(`FX API error response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { base: "USD", rates: data.rates, fetchedAt: new Date() };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Returns the current USD-base rate table, refreshing from the live API if
 * the DB-cached copy is missing or older than `CACHE_TTL_MS`. Falls back to
 * a stale cached copy (rather than throwing) if the live fetch fails —
 * showing a slightly-stale converted price is far better UX than breaking
 * the wallet/order pages over a transient upstream outage, and this is
 * DISPLAY-only data so staleness has no correctness impact on money
 * actually held/charged.
 */
export async function getExchangeRates(): Promise<RatesSnapshot> {
  const cached = await prisma.exchangeRateCache.findUnique({ where: { key: "latest" } });
  const isFresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS;

  if (isFresh) {
    return { base: "USD", rates: cached.rates as Record<string, number>, fetchedAt: new Date(cached.fetchedAt) };
  }

  try {
    const live = await fetchLiveRates();
    await prisma.exchangeRateCache.upsert({
      where: { key: "latest" },
      update: { base: "USD", rates: live.rates as Prisma.InputJsonValue, fetchedAt: live.fetchedAt },
      create: { key: "latest", base: "USD", rates: live.rates as Prisma.InputJsonValue, fetchedAt: live.fetchedAt },
    });
    return live;
  } catch (err) {
    if (cached) {
      logger.warn(
        { err, staleSince: cached.fetchedAt.toISOString() },
        "[currency] Live FX fetch failed, serving stale cached rates"
      );
      return { base: "USD", rates: cached.rates as Record<string, number>, fetchedAt: new Date(cached.fetchedAt) };
    }
    // No cache at all yet (first run) and the live fetch failed — genuinely
    // nothing to convert with. Callers must handle this by falling back to
    // USD-only display (see `convertFromUsd`'s null return).
    logger.error({ err }, "[currency] Live FX fetch failed and no cached rates exist");
    throw err;
  }
}

/**
 * Converts a USD amount to `targetCurrency` for DISPLAY ONLY, using the
 * current cached/live rate table. Returns `null` (never throws) if rates
 * are unavailable — callers should fall back to showing USD alone rather
 * than blocking a page render over a currency-conversion nicety.
 */
export async function convertFromUsd(amountUsd: number, targetCurrency: DisplayCurrency): Promise<number | null> {
  if (targetCurrency === "USD") return amountUsd;
  try {
    const { rates } = await getExchangeRates();
    const rate = rates[targetCurrency];
    if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
    return amountUsd * rate;
  } catch {
    return null;
  }
}
