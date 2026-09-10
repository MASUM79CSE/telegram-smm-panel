import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

/**
 * Locale-scoped layout, nested under the genuine root layout (`app/layout.tsx`,
 * which owns <html>/<body>). Everything under `app/[locale]/**` is the
 * customer-facing surface (marketing site, public catalog, auth, customer
 * dashboard) — see docs/I18N_PLAN.md §2 for why `/admin/**` deliberately
 * sits outside this segment instead.
 *
 * `generateStaticParams` + a real `<html lang>`/metadata per locale, per
 * next-intl's documented static-rendering setup (not a stub — every locale
 * this app declares gets a genuinely distinct, translated `<title>`/
 * `<description>` via `getTranslations`, not a hardcoded English string
 * reused for every language).
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  // Enables static rendering for this locale (see next-intl's docs on
  // `setRequestLocale` — without this, every page under `[locale]` would be
  // forced into fully dynamic rendering just because `useTranslations` is
  // called somewhere in the tree).
  setRequestLocale(locale);

  // `<html lang>` itself lives on the shared root layout (`app/layout.tsx`)
  // since Next.js only allows one <html> tag per response and that layout
  // is also used by `/admin/**` — see that file's `x-locale` header read for
  // how the resolved locale reaches it despite the segment boundary.
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}
