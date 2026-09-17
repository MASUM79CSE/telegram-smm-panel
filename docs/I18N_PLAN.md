# Internationalization (i18n) & Currency Display

This document covers the internationalization architecture: locale routing scope/rationale, translation file organization, the customer/back-office routing split, and the live currency-display conversion layer. It is the doc `docs/IMPLEMENTATION_PLAN.md`'s Phase 4 section and `MEMORY.md` both said would be produced "when i18n is greenlit" — i18n has since been built and shipped; this document records the actual, as-built architecture (not a forward-looking plan), and is the doc several code comments (`i18n/routing.ts`, `i18n/navigation.ts`, `i18n/request.ts`, `proxy.ts`, `app/layout.tsx`, `app/[locale]/layout.tsx`, `app/[locale]/page.tsx`, `components/dashboard/status-badge.tsx`, `components/support/ticket-reply-form.tsx`) already cite by section number.

Status: **shipped and verified live** (see `docs/IMPLEMENTATION_PLAN.md` Phase 4 for the verification record — real live-fetched exchange rates checked against the actual cached DB value, headless-browser screenshots across desktop/mobile and both locales).

---

## 1. Locale scope & rationale

**Supported locales: English (`en`, default) + Bengali (`bn`).** Defined in `i18n/routing.ts`.

This is a real, defensible target-market decision, not a placeholder or an arbitrary "add a popular language" pick:

- Bangladesh has one of the world's largest concentrations of SMM-panel operators and resellers — a well-documented characteristic of this specific industry (see `docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md` for the broader competitive context this project operates in).
- Bengali is this project's own operating context (the project runs in `Asia/Dhaka`, reflected in `i18n/request.ts`'s `timeZone` config).

Adding a third locale later means: add it to `routing.locales` in `i18n/routing.ts`, add a `messages/<locale>.json` file with every key from `messages/en.json` translated, and (if it needs a non-USD default display currency) add an entry to `defaultDisplayCurrencyForLocale()` in `lib/currency-format.ts` (see §4 below). No other structural change is needed — every page/component already reads locale-driven text and currency through those two mechanisms rather than hardcoding English/USD.

**`localePrefix: "as-needed"`** — English (the default) is served unprefixed (`/services`, `/dashboard`, `/`) so every pre-i18n bookmark, external link, and the sitemap keep working with zero redirects. Bengali is served under `/bn/...` (`/bn/services`, `/bn/dashboard`). This matches the "additive, non-breaking" convention used for every other schema/route change in this project (see `MEMORY.md` §3).

---

## 2. Customer-facing vs. back-office routing split

**`/admin/**` deliberately sits OUTSIDE the `[locale]` segment** — it is, and remains, English-only back-office tooling. This is a scope decision, not an oversight:

- `app/admin/**` is a separate route tree from `app/[locale]/**`.
- `proxy.ts` explicitly excludes `/admin/**` (and `/api/**`) from next-intl's routing middleware — see the "Composition with next-intl" section of that file's doc comment.
- `i18n/request.ts`'s per-request config must fall back to `routing.defaultLocale` (not call `notFound()`) when no locale can be resolved, specifically because the shared root layout (`app/layout.tsx`) calls `getLocale()` on every request including `/admin/**`, and those requests legitimately carry no `x-next-intl-locale` header.
- `components/dashboard/status-badge.tsx` and `components/support/ticket-reply-form.tsx` are two concrete examples of shared UI pieces that are reused by both the (locale-aware) customer dashboard and the (English-only) admin panel — both files contain the actual logic for behaving correctly in either context (translated strings when rendered under `[locale]`, plain English when rendered under `/admin`).

If back-office translation is ever wanted, it would need its own explicit scope decision (which admin surfaces, which languages) — don't assume it's implied by the customer-facing locales above.

`/api/**` is likewise untouched by locale routing — it's machine-to-machine and was never locale-prefixed (reseller API consumers, the Telegram webhook, etc. don't get or need a `[locale]` segment).

---

## 3. Navigation & routing mechanics

- **`i18n/routing.ts`** — the single source of truth for `locales`/`defaultLocale`/`localePrefix`, via `next-intl`'s `defineRouting()`. Also exports the `AppLocale` type used for locale-parameter typing elsewhere.
- **`i18n/navigation.ts`** — `createNavigation(routing)`'s locale-aware `Link`/`redirect`/`usePathname`/`useRouter`/`getPathname`. Use these instead of the plain `next/link`/`next/navigation` exports **everywhere in customer-facing UI** — they automatically preserve/apply the current locale prefix. Notable exception: Server Actions' `redirect()` and API routes keep using plain Next.js APIs, since `next-intl`'s locale-aware `redirect` only works from within a request that already resolved a `[locale]` segment (API routes and most Server Actions don't).
- **`i18n/request.ts`** — per-request i18n config for Server Components/Server Actions, read via `next-intl/server`'s `getRequestConfig`. Resolves the locale from `requestLocale` (populated from the `x-next-intl-locale` header next-intl's middleware attaches), not from `next/root-params` — the latter's named per-segment exports are not generated by Turbopack as of Next.js 16.3 (a confirmed, currently open upstream bug: [vercel/next.js#92742](https://github.com/vercel/next.js/issues/92742)), which breaks the production build entirely if relied on. `requestLocale` is the fully-supported, non-experimental alternative, and pairs with `setRequestLocale(locale)` (called in `app/[locale]/layout.tsx`) to keep static rendering working per next-intl's documented setup.
- **`proxy.ts`** — runs next-intl's locale-routing middleware (`createIntlMiddleware(routing)`) for every request except `/admin/**` and `/api/**`, composed alongside this project's own auth-redirect and CORS/CSP logic. See that file's own doc comment for the specific composition details (why `authConfig.callbacks.authorized` has to be called manually here rather than relying on NextAuth's automatic enforcement, and how the CSP nonce is forwarded through next-intl's own request/response rewriting).

---

## 4. Translation file organization

- **`messages/en.json`** / **`messages/bn.json`** — one JSON file per locale, loaded by `i18n/request.ts` via `(await import(`../messages/${locale}.json`)).default`. Both files must have matching key structure; `en.json` is the canonical key source (add a new key there first, then translate it into `bn.json`).
- Namespaced by page/feature area (e.g. `Dashboard.wallet`, `Services`, `Nav`, `Auth.login`, `OrderForm`, `StatusBadge`, `RefillStatus`, `LocaleSwitcher`) — components call `useTranslations("Namespace")` (client) or `getTranslations("Namespace")` (server) and reference keys within that namespace, rather than one flat global key list.
- Every customer-facing string is expected to go through this mechanism — a hardcoded English string in a component under `app/[locale]/**` or in a shared component rendered there is a bug to fix, not an acceptable shortcut, per the same "no demo/placeholder shortcuts" standard applied elsewhere in this project.
- `NextIntlClientProvider` (in `app/[locale]/layout.tsx`) makes the resolved messages available to client components in that subtree.

---

## 5. Live currency-display conversion

**Ground rule: this is a display-only layer. The wallet ledger, `Order.charge`, `Transaction.amount`, and every other money field in the database remain Prisma `Decimal` USD, exactly as documented in `docs/DATABASE.md` and `lib/money.ts`.** Nothing in this section reads, writes, or converts a stored monetary value — it only computes a second, on-screen-only number for display, alongside the real USD amount.

### 5.1 Why this exists

Bengali-locale users see prices/balances in BDT (Bangladeshi Taka) as well as USD, since that's the currency they actually think in day-to-day, without introducing any actual multi-currency accounting complexity (no FX risk, no settlement currency question, no changes to how money moves).

### 5.2 Architecture

| Module | Role |
|---|---|
| `ExchangeRateCache` (`prisma/schema.prisma`) | Singleton row (`key: "latest"`) caching `{base: "USD", rates, fetchedAt}` — the full rate table from the upstream API, `rates` stored as a `Json` column. DB-backed (not in-memory) for multi-instance/serverless consistency, mirroring the existing `Settings` singleton-row pattern. |
| `lib/currency-format.ts` | **Client-safe**, pure formatting module — no I/O, no Prisma import. Exports `DISPLAY_CURRENCIES` (`["USD", "BDT"]`), `DisplayCurrency` type, `formatCurrencyAmount(amount, currency, fractionDigits?)` (locale-correct `Intl.NumberFormat`, e.g. Bengali-digit output for `BDT`), `defaultDisplayCurrencyForLocale(locale)` (`bn` → `BDT`, everything else → `USD`), and the `ATTRIBUTION_TEXT`/`ATTRIBUTION_URL` constants. Split out specifically so client components (e.g. `components/public/service-catalog.tsx`, `components/dashboard/order-form.tsx`) can format prices without bundling the Prisma client into client JavaScript. |
| `lib/currency.ts` | Server-only I/O — `getExchangeRates()` (DB-cached, 1-hour TTL, falls back to stale cache on fetch failure) and `convertFromUsd(amountUsd, targetCurrency)` (never throws; returns `null` on any failure). Re-exports the pure helpers from `lib/currency-format.ts` for convenience at server call sites. |
| `lib/services/display-money.ts` | Call-site helpers: `getDisplayMoney(amount, locale)` → `{primary, secondary, secondaryCurrency}` for a single amount; `getDisplayMoneyBatch(amounts[], locale)` → the same shape for a list, fetching the rate table once and reusing it (avoids N separate DB round-trips on list views like transaction history/order tables). `secondary`/`secondaryCurrency` are `null` whenever the locale defaults to USD or conversion is unavailable — callers render primary-only in that case, never a broken or blank secondary value. |
| `components/shared/dual-currency.tsx` | Presentational `<DualCurrency money={} size="sm"|"md"|"lg" />` — primary amount plus an optional muted `≈ secondary` line, for Server Component pages. |

### 5.3 Rate source, caching, and fallback behavior

- **Source:** the free, keyless "Open Access" endpoint of exchangerate-api.com (`https://open.er-api.com/v6/latest/USD`) — updates once per day, no API key required.
- **Caching:** a 1-hour TTL against the `ExchangeRateCache` DB document. Per that service's own free-tier terms, caching is explicitly expected (refetching more than hourly gains nothing since the underlying data only refreshes daily, and risks IP rate-limiting).
- **Fallback on fetch failure:** serves the last-known cached rates (with a logged warning) rather than breaking the page — a stale converted price is far better UX than an error, since this is purely cosmetic/display data with no correctness impact on money actually held or charged. It only throws (surfaced by `getExchangeRates()`, but still caught and turned into `null` by `convertFromUsd()`) if there is truly no cache at all yet AND the live fetch also fails — i.e. a first-ever cold start with the upstream API down.
- **Attribution:** exchangerate-api.com's free-tier terms require attribution wherever converted rates are shown. `ATTRIBUTION_TEXT`/`ATTRIBUTION_URL` (`lib/currency-format.ts`) are rendered as a visible link next to every converted amount — currently on the wallet page and the public service catalog (wherever a secondary BDT amount actually appears). A more centralized/persistent placement (e.g. a global footer) was considered but not required, since the per-page contextual placement already satisfies "wherever rates are shown."

### 5.4 Where it's wired in

| Surface | What's shown |
|---|---|
| `/dashboard` (home) | Wallet-balance stat card via `<DualCurrency>` |
| `/dashboard/wallet` | Balance line + every transaction-history row, via `getDisplayMoney`/`getDisplayMoneyBatch` |
| `/dashboard/orders` | Each order's charge, batched |
| `/dashboard/services` (order form) | The interactive estimated-charge line recalculates its BDT equivalent live as quantity changes, using a rate resolved once server-side and passed to the client component (no client-side DB access) |
| `/services` (public catalog) | Every listed service's rate, using the same server-resolved-rate-passed-to-client-component pattern as the order form |
| `/` (landing page) | The cheapest-services pricing preview table |

All of the above render **real, live-fetched exchange rates** — not a hardcoded or simulated conversion factor.

### 5.5 Adding a new display currency

1. Add the ISO code to `DISPLAY_CURRENCIES` in `lib/currency-format.ts`.
2. Add a `CURRENCY_NUMBER_LOCALE` entry (the `Intl.NumberFormat` locale tag to use for that currency's digit/grouping style).
3. Add a `defaultDisplayCurrencyForLocale()` case for whichever app locale(s) should default to it.

No changes are needed to `lib/currency.ts`, `display-money.ts`, or any page — the upstream rate table already contains every ISO currency code the free API supports, so a new `DisplayCurrency` just needs to be recognized by the formatting layer.

---

## 6. Testing/verification notes for future changes

- `Intl.NumberFormat` behavior was verified directly (not assumed) before building on it: `new Intl.NumberFormat("bn-BD", {style:"currency", currency:"BDT", currencyDisplay:"narrowSymbol"})` produces genuine Bengali-digit output (e.g. `১,২৩৪.৫০৳`), confirmed via a throwaway `node -e` script.
- The currency-conversion math was cross-checked end-to-end against the real cached DB rate at least once (not just unit-level): a $1.50 amount rendered as `≈ ৳184.04` on the live dev server, matching `1.50 × 122.692712` (the actual `BDT` rate stored in `ExchangeRateCache` at the time) to the cent.
- If you touch any of the modules in §5.2, re-verify similarly against the real `ExchangeRateCache` document — don't just trust that the formatting/conversion "looks right" in isolation, since a silent unit mismatch (e.g. treating a per-1000 rate as a per-unit rate) would be easy to miss without a real-number cross-check.
