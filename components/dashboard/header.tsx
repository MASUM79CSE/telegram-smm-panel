"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { getPathname } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { NotificationBell } from "@/components/shared/notification-bell";

export function DashboardHeader({ name }: { name?: string | null }) {
  const t = useTranslations("Dashboard.header");
  const locale = useLocale();
  // `signOut` takes a plain URL string (it's not a next-intl-aware router
  // call), so the locale-prefixed `/login` path is constructed explicitly
  // here — otherwise a signed-out `bn` user would silently land back on the
  // unprefixed English login page instead of `/bn/login`.
  const loginHref = getPathname({ href: "/login", locale });
  // Notification `href`s are stored as plain, unprefixed paths (e.g.
  // "/dashboard/orders") — this project's `localePrefix: "as-needed"`
  // config (see i18n/routing.ts) means only non-default locales need a
  // prefix added client-side before navigating.
  const notificationLinkPrefix = locale === "en" ? "" : `/${locale}`;

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 sm:px-6">
      <div className="flex items-center gap-3">
        {/* Below `md` the persistent Sidebar is hidden entirely, so this
            drawer is the only way to navigate — not decorative. */}
        <MobileNav />
        <h2 className="font-semibold text-white">{t("title")}</h2>
      </div>

      <div className="flex items-center gap-4">
        <NotificationBell linkPrefix={notificationLinkPrefix} />
        <LocaleSwitcher />

        <div className="text-right">
          <p className="text-sm font-medium text-white">{name || t("defaultUser")}</p>
        </div>

        <button
          onClick={() => signOut({ callbackUrl: loginHref })}
          className="rounded-lg p-2 text-slate-400 hover:bg-red-950 hover:text-red-400"
          aria-label={t("signOut")}
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
