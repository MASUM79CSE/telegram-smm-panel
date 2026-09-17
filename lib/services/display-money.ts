import { decimalToNumber } from "@/lib/money";
import { convertFromUsd, getExchangeRates } from "@/lib/currency";
import { defaultDisplayCurrencyForLocale, formatCurrencyAmount, type DisplayCurrency } from "@/lib/currency-format";
import type { Money } from "@/lib/money";

/**
 * Server-side helper that pairs the canonical USD amount (always shown,
 * always correct, never dependent on a network call) with a live-converted
 * secondary display amount in the locale's default local currency (Phase 4
 * i18n/growth — see `lib/currency.ts`'s module doc for the full ledger vs.
 * display rationale).
 *
 * `secondary` is `null` whenever the locale's default currency IS USD (no
 * conversion needed — `en` shows USD only) or when live/cached rates are
 * genuinely unavailable (first-ever request with the upstream API down) —
 * callers must treat `null` as "render primary only", never as an error.
 */
export interface DisplayMoney {
  primary: string;
  secondary: string | null;
  secondaryCurrency: DisplayCurrency | null;
}

export async function getDisplayMoney(
  amount: Money | number | string,
  locale: string
): Promise<DisplayMoney> {
  const usd = decimalToNumber(amount);
  const primary = formatCurrencyAmount(usd, "USD");

  const targetCurrency = defaultDisplayCurrencyForLocale(locale);
  if (targetCurrency === "USD") {
    return { primary, secondary: null, secondaryCurrency: null };
  }

  const converted = await convertFromUsd(usd, targetCurrency);
  if (converted === null) {
    return { primary, secondary: null, secondaryCurrency: null };
  }

  return { primary, secondary: formatCurrencyAmount(converted, targetCurrency), secondaryCurrency: targetCurrency };
}

/**
 * Batch variant of `getDisplayMoney` for lists (e.g. a transaction/order
 * table) — fetches the rate table ONCE (a single cached/live lookup, see
 * `lib/currency.ts#getExchangeRates`) and reuses it for every amount,
 * rather than each row independently re-querying the `ExchangeRateCache`
 * collection. Falls back to primary-only for every row if rates are
 * unavailable, same contract as `getDisplayMoney`.
 */
export async function getDisplayMoneyBatch(
  amounts: Array<Money | number | string>,
  locale: string
): Promise<DisplayMoney[]> {
  const targetCurrency = defaultDisplayCurrencyForLocale(locale);

  if (targetCurrency === "USD") {
    return amounts.map((amount) => ({
      primary: formatCurrencyAmount(decimalToNumber(amount), "USD"),
      secondary: null,
      secondaryCurrency: null,
    }));
  }

  let rate: number | null = null;
  try {
    const { rates } = await getExchangeRates();
    rate = typeof rates[targetCurrency] === "number" ? rates[targetCurrency] : null;
  } catch {
    rate = null;
  }

  return amounts.map((amount) => {
    const usd = decimalToNumber(amount);
    const primary = formatCurrencyAmount(usd, "USD");
    if (rate === null) return { primary, secondary: null, secondaryCurrency: null };
    return {
      primary,
      secondary: formatCurrencyAmount(usd * rate, targetCurrency),
      secondaryCurrency: targetCurrency,
    };
  });
}
