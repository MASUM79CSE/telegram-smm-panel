/**
 * Client-safe currency formatting/constants — pure functions, no I/O, no
 * server-only imports (no `mongoose`/`connectDB`). Split out from
 * `lib/currency.ts` (which does the actual live/cached rate FETCHING and
 * therefore imports server-only modules) specifically so client components
 * like `components/public/service-catalog.tsx` can format an
 * already-fetched rate table without bundling Mongoose into client
 * JavaScript.
 */
export const DISPLAY_CURRENCIES = ["USD", "BDT"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

const CURRENCY_NUMBER_LOCALE: Record<DisplayCurrency, string> = {
  USD: "en-US",
  BDT: "bn-BD",
};

export function formatCurrencyAmount(
  amount: number,
  currency: DisplayCurrency,
  /** Override the default 2-decimal display, e.g. `4` for a sub-cent per-unit estimate. */
  fractionDigits?: number
): string {
  return new Intl.NumberFormat(CURRENCY_NUMBER_LOCALE[currency], {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    ...(fractionDigits !== undefined
      ? { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }
      : {}),
  }).format(amount);
}

/**
 * The one display currency each of this app's locales defaults to when a
 * user hasn't set an explicit preference — `bn` (Bengali, Bangladesh) shows
 * BDT by default (see `i18n/routing.ts`'s own rationale for why `bn` was
 * chosen: Bangladesh is a major SMM-panel market), `en` shows the ledger
 * currency (USD) as-is with no conversion step at all.
 */
export function defaultDisplayCurrencyForLocale(locale: string): DisplayCurrency {
  return locale === "bn" ? "BDT" : "USD";
}

export const ATTRIBUTION_TEXT = "Rates by ExchangeRate-API";
export const ATTRIBUTION_URL = "https://www.exchangerate-api.com";
