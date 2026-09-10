"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Languages } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * Real, working locale switcher (Phase 4 i18n follow-up — this was
 * previously entirely missing despite the routing/translation
 * infrastructure being fully functional underneath it).
 *
 * Uses `next-intl`'s locale-aware `useRouter`/`usePathname` (from
 * `@/i18n/navigation`, not plain `next/navigation`) so switching locale
 * re-renders the CURRENT page/path under the new locale prefix rather than
 * bouncing the user back to the homepage — e.g. switching from `/services`
 * to `bn` lands on `/bn/services`, not `/bn`.
 *
 * `router.replace(pathname, { locale })` is next-intl's documented pattern
 * for this exact use case (see next-intl docs "routing/navigation" ->
 * "Changing the locale"). `replace` (not `push`) is used deliberately so
 * switching languages doesn't pollute browser back-history with duplicate
 * entries for the same logical page in two locales.
 */
const LOCALE_META: Record<string, { flag: string; nativeName: string }> = {
  en: { flag: "🇺🇸", nativeName: "English" },
  bn: { flag: "🇧🇩", nativeName: "বাংলা" },
};

export function LocaleSwitcher({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const t = useTranslations("LocaleSwitcher");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function switchTo(nextLocale: string) {
    setOpen(false);
    if (nextLocale === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  }

  const current = LOCALE_META[locale] ?? LOCALE_META.en;
  const isDark = variant === "dark";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("label")}
        className={`group flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-200 disabled:opacity-60 ${
          isDark
            ? "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        }`}
      >
        <Languages className="h-4 w-4 opacity-70 transition-opacity group-hover:opacity-100" />
        <span aria-hidden className="text-base leading-none">
          {current.flag}
        </span>
        <span className="hidden sm:inline">{current.nativeName}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className={`animate-panel-pop-in absolute right-0 z-50 mt-2 w-44 origin-top-right overflow-hidden rounded-xl border shadow-xl shadow-black/40 backdrop-blur-xl ${
            isDark ? "border-slate-800 bg-slate-950/95" : "border-slate-200 bg-white/95"
          }`}
        >
          {routing.locales.map((loc) => {
            const meta = LOCALE_META[loc] ?? { flag: "🌐", nativeName: loc };
            const active = loc === locale;
            return (
              <button
                key={loc}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => switchTo(loc)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  active
                    ? isDark
                      ? "bg-blue-600/15 text-blue-400"
                      : "bg-blue-50 text-blue-600"
                    : isDark
                      ? "text-slate-300 hover:bg-slate-900"
                      : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span aria-hidden className="text-base leading-none">
                  {meta.flag}
                </span>
                <span className="flex-1 font-medium">{meta.nativeName}</span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
