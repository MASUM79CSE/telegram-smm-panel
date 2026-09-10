"use client";

import { useEffect, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Menu, X, Send } from "lucide-react";
import { useDashboardNavItems } from "./nav-items";

/**
 * Mobile navigation drawer (Phase 4 visual-polish follow-up).
 *
 * `Sidebar` is `hidden md:flex` — below the `md` breakpoint there was
 * previously NO way to navigate between dashboard sections at all other
 * than editing the URL bar by hand, since `DashboardHeader` only rendered
 * the page title/locale-switcher/sign-out button. This component fixes
 * that real, functional gap (not just a visual one) with a slide-in
 * drawer reusing the exact same nav item list as the desktop sidebar via
 * `useDashboardNavItems`, so the two can never drift out of sync.
 */
export function MobileNav() {
  const pathname = usePathname();
  const tNav = useTranslations("Nav");
  const t = useTranslations("Dashboard.header");
  const menuItems = useDashboardNavItems();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("openMenu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label={t("closeMenu")}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <div className="animate-panel-pop-in absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-slate-800 bg-slate-950 shadow-2xl">
            <div className="flex h-16 items-center justify-between gap-3 border-b border-slate-800 px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
                  <Send className="h-5 w-5 text-white" />
                </div>
                <span className="font-bold text-white">{tNav("brand")}</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("closeMenu")}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto p-4">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                      active ? "bg-blue-600/15 text-blue-400" : "text-slate-400 hover:bg-slate-900 hover:text-white"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-blue-500" />
                    )}
                    <Icon className={`h-5 w-5 shrink-0 ${active ? "text-blue-400" : "text-slate-500"}`} />
                    {item.title}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
