import NextLink from "next/link";
import { Send } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { getPublicCatalog } from "@/lib/services/catalog";
import { ServiceCatalog } from "@/components/public/service-catalog";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { defaultDisplayCurrencyForLocale } from "@/lib/currency-format";
import { convertFromUsd } from "@/lib/currency";

/**
 * Public, unauthenticated service catalog page (see
 * docs/IMPLEMENTATION_PLAN.md Phase 1.2). Deliberately OUTSIDE `/dashboard`
 * and `/admin`, so `auth.config.ts`'s `authorized()` callback does not gate
 * it (confirmed by reading that callback before writing this page — it
 * only special-cases `/dashboard` and `/admin` prefixes, everything else,
 * including this route, passes through ungated).
 *
 * `auth()` is still called directly here (same pattern as `app/page.tsx`)
 * — not to gate access, but to decide the CTA destination/label for an
 * already-logged-in visitor vs. an anonymous one.
 *
 * Data fetching happens directly in this Server Component via
 * `lib/services/catalog.ts` rather than doing a client-side fetch to
 * `/api/public/services` — avoids a network round-trip and keeps the page
 * server-rendered/crawlable with real data in the initial HTML (important
 * for the SEO-crawlability acceptance criterion). The API route exists
 * independently for any other consumer (e.g. a future embeddable widget).
 *
 * Phase 4 (docs/I18N_PLAN.md): metadata + all customer-facing copy is now
 * translated via `messages/{locale}.json`'s `Services`/`Nav` namespaces.
 */
export async function generateMetadata() {
  const t = await getTranslations("Services");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function ServicesPage() {
  const session = await auth();
  const locale = await getLocale();
  await connectDB();
  const { groups, totalServices } = await getPublicCatalog();
  const t = await getTranslations("Services");
  const tNav = await getTranslations("Nav");

  // Phase 4 currency-display conversion: resolve a single USD->local rate
  // once here (server-side) and pass it down as a plain number, rather than
  // making the client `ServiceCatalog` component fetch/query the DB itself
  // — it renders every service's rate live client-side (search/filter is
  // interactive), so this keeps that interactivity while still showing a
  // real, live-converted secondary price per row.
  const displayCurrency = defaultDisplayCurrencyForLocale(locale);
  const displayRate = displayCurrency === "USD" ? null : await convertFromUsd(1, displayCurrency);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
            <Send className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold text-white">{tNav("brand")}</span>
        </Link>

        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          {session?.user ? (
            session.user.role === "ADMIN" ? (
              // `/admin` deliberately sits OUTSIDE the `[locale]` segment
              // (see docs/IMPLEMENTATION_PLAN.md Phase 4 / i18n/routing.ts) —
              // next-intl's locale-aware `Link` would incorrectly prefix it
              // with the current locale (e.g. `/bn/admin`, a route that
              // doesn't exist), so plain `next/link` is used here on purpose.
              <NextLink
                href="/admin"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                {tNav("goToDashboard")}
              </NextLink>
            ) : (
              <Link
                href="/dashboard"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                {tNav("goToDashboard")}
              </Link>
            )
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-slate-300 hover:text-white">
                {tNav("login")}
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                {tNav("getStarted")}
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10 text-center">
          <h1 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-slate-400">{t("subtitle")}</p>
        </div>

        {groups.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">
            {t("noServices")}
          </div>
        ) : (
          <ServiceCatalog
            groups={groups}
            totalServices={totalServices}
            isLoggedIn={!!session?.user}
            displayCurrency={displayCurrency}
            displayRate={displayRate}
          />
        )}
      </main>
    </div>
  );
}
