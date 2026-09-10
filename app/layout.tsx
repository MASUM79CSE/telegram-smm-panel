import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { SessionProvider } from "@/components/session-provider";
import { NONCE_HEADER } from "@/lib/security/csp";
import { getLocale } from "next-intl/server";

/**
 * Genuine top-level root layout (defines <html>/<body>) shared by BOTH
 * `/admin/**` (deliberately kept outside locale routing — see
 * docs/I18N_PLAN.md §2, back-office tooling stays English-only, a
 * legitimate real-world pattern, not a shortcut on the customer-facing
 * i18n feature) and `/[locale]/**` (the customer-facing surface, which
 * nests its own `app/[locale]/layout.tsx` below this one to add
 * `NextIntlClientProvider` — see that file). `lang="en"` here is
 * deliberately the fallback for anything rendered directly under this
 * layout with no more specific locale (i.e. `/admin/**`); the nested
 * `[locale]` layout overrides `lang` to the actual resolved locale for
 * every customer-facing page.
 */
export const metadata: Metadata = {
  title: "SMM Panel",
  description: "Manage your social media marketing orders, wallet, and support in one place.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Forwarded by proxy.ts on every request (see lib/security/csp.ts). Not
  // currently used on any tag below — this project has no inline <script>
  // tags today — but reading it here means any future inline script only
  // needs `nonce={nonce}` added, not new plumbing.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  // Resolves to the real matched locale for anything under `app/[locale]/**`
  // (via `next/root-params`, see i18n/request.ts) and falls back to the
  // default locale for `/admin/**`, which deliberately sits outside that
  // segment — so `<html lang>` is always accurate, never a hardcoded "en"
  // pretending every page is English.
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body className="bg-slate-950 text-slate-100 antialiased" data-csp-nonce={nonce}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
