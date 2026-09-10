import { redirect as nextRedirect } from "next/navigation";
import { auth } from "@/auth";
import { getTranslations, getLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import {
  Send,
  ShieldCheck,
  Wallet,
  Headphones,
  LayoutDashboard,
  HelpCircle,
  ClipboardList,
  Lock,
} from "lucide-react";
import { connectDB } from "@/lib/db";
import { getCheapestServices } from "@/lib/services/catalog";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { getDisplayMoneyBatch } from "@/lib/services/display-money";

/**
 * Landing page rebuild (docs/IMPLEMENTATION_PLAN.md Phase 1.3). Per the
 * project-owner decision (see MEMORY.md §1), this project is a
 * multi-platform SMM panel, not Telegram-only — copy below reflects that.
 *
 * Every feature claim below is grounded in README.md §1's feature list
 * (the source of truth for "what this project actually does") — nothing
 * here is invented/unverifiable marketing copy. The FAQ is written in this
 * project's own voice and deliberately avoids the unverifiable "real,
 * active accounts" style claim flagged in
 * docs/COMPETITIVE_ANALYSIS_AND_ROADMAP.md as something this project
 * can't honestly back up.
 *
 * The pricing preview below pulls the actual cheapest live services from
 * the DB via the same `lib/services/catalog.ts` helper the public catalog
 * page/API use (Phase 1.2) — not hardcoded example prices. The existing
 * redirect-if-authenticated logic is preserved unchanged.
 *
 * Phase 4 (docs/I18N_PLAN.md): all customer-facing copy below is now
 * sourced from `messages/{locale}.json` (namespace `Home`/`Nav`) via
 * `getTranslations`, translated genuinely for both `en` and `bn` — not a
 * stubbed/English-only string.
 */
export default async function Home() {
  const session = await auth();
  const locale = await getLocale();

  if (session?.user) {
    // `/admin` sits deliberately OUTSIDE locale routing (see
    // docs/I18N_PLAN.md §2) — a locale prefix must never be applied to it,
    // so it uses the plain (non-locale-aware) Next.js `redirect` while
    // `/dashboard`, which IS under `[locale]`, uses next-intl's
    // locale-aware `redirect` to preserve the current locale.
    if (session.user.role === "ADMIN") {
      nextRedirect("/admin");
    }
    redirect({ href: "/dashboard", locale });
  }

  await connectDB();
  const cheapestServices = await getCheapestServices(4);
  const cheapestServicePrices = await getDisplayMoneyBatch(
    cheapestServices.map((s) => s.rate),
    locale
  );

  const t = await getTranslations("Home");
  const tNav = await getTranslations("Nav");

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
            <Send className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold text-white">{tNav("brand")}</span>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/services" className="text-sm font-medium text-slate-300 hover:text-white">
            {tNav("catalog")}
          </Link>
          <Link href="/login" className="text-sm font-medium text-slate-300 hover:text-white">
            {tNav("login")}
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            {tNav("getStarted")}
          </Link>
          <LocaleSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
          {t("heroTitle")}
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-400">{t("heroSubtitle")}</p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/register"
            className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-500"
          >
            {t("createAccount")}
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-slate-700 px-6 py-3 font-medium text-slate-200 hover:bg-slate-900"
          >
            {t("signIn")}
          </Link>
          <Link
            href="/services"
            className="rounded-lg border border-slate-700 px-6 py-3 font-medium text-slate-200 hover:bg-slate-900"
          >
            {t("viewCatalog")}
          </Link>
        </div>

        {cheapestServices.length > 0 && (
          <section className="mx-auto mt-24 max-w-4xl text-left">
            <h2 className="text-center text-2xl font-bold text-white">{t("pricingTitle")}</h2>
            <p className="mt-2 text-center text-sm text-slate-400">{t("pricingSubtitle")}</p>

            <div className="mt-8 overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("platform")}</th>
                    <th className="px-4 py-3 font-medium">{t("service")}</th>
                    <th className="px-4 py-3 font-medium text-right">{t("ratePer1000")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {cheapestServices.map((service, i) => (
                    <tr key={service._id} className="bg-slate-950/40">
                      <td className="px-4 py-3 text-slate-400">{service.groupName}</td>
                      <td className="px-4 py-3 text-slate-200">{service.name}</td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {cheapestServicePrices[i].primary}
                        {cheapestServicePrices[i].secondary && (
                          <span className="ml-1.5 text-xs text-slate-500">
                            ≈ {cheapestServicePrices[i].secondary}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 text-center">
              <Link href="/services" className="text-sm font-medium text-blue-400 hover:text-blue-300">
                {t("viewFullCatalog")}
              </Link>
            </div>
          </section>
        )}

        <section className="mx-auto mt-24 max-w-4xl">
          <h2 className="text-2xl font-bold text-white">{t("whatYouGet")}</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <Feature icon={LayoutDashboard} title={t("feature1Title")} desc={t("feature1Desc")} />
            <Feature icon={ShieldCheck} title={t("feature2Title")} desc={t("feature2Desc")} />
            <Feature icon={Wallet} title={t("feature3Title")} desc={t("feature3Desc")} />
            <Feature icon={ClipboardList} title={t("feature4Title")} desc={t("feature4Desc")} />
            <Feature icon={Send} title={t("feature5Title")} desc={t("feature5Desc")} />
            <Feature icon={Headphones} title={t("feature6Title")} desc={t("feature6Desc")} />
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-3xl text-left">
          <h2 className="text-center text-2xl font-bold text-white">{t("faqTitle")}</h2>
          <div className="mt-8 space-y-6">
            <Faq q={t("faq1Q")} a={t("faq1A")} />
            <Faq q={t("faq2Q")} a={t("faq2A")} />
            <Faq q={t("faq3Q")} a={t("faq3A")} />
            <Faq q={t("faq4Q")} a={t("faq4A")} />
            <Faq q={t("faq5Q")} a={t("faq5A")} />
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/40 p-10">
          <Lock className="mx-auto h-8 w-8 text-blue-500" />
          <h2 className="mt-4 text-xl font-bold text-white">{t("readyTitle")}</h2>
          <p className="mt-2 text-slate-400">{t("readySubtitle")}</p>
          <div className="mt-6 flex justify-center gap-4">
            <Link
              href="/register"
              className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-500"
            >
              {t("createAccount")}
            </Link>
            <Link
              href="/services"
              className="rounded-lg border border-slate-700 px-6 py-3 font-medium text-slate-200 hover:bg-slate-900"
            >
              {t("browseCatalogFirst")}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-left">
      <Icon className="h-6 w-6 text-blue-500" />
      <h3 className="mt-3 font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-400">{desc}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="flex items-center gap-2 font-semibold text-white">
        <HelpCircle className="h-4 w-4 shrink-0 text-blue-500" />
        {q}
      </h3>
      <p className="mt-2 text-sm text-slate-400">{a}</p>
    </div>
  );
}
