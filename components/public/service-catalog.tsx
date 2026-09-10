"use client";

import { useMemo, useState } from "react";
import { Search, Layers } from "lucide-react";
import { SiTelegram, SiInstagram, SiTiktok, SiYoutube, SiFacebook, SiX, SiSpotify, SiTwitch, SiDiscord, SiSnapchat, SiWhatsapp, SiThreads, SiPinterest } from "react-icons/si";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { CatalogGroup } from "@/lib/services/catalog";
import {
  formatCurrencyAmount,
  ATTRIBUTION_TEXT,
  ATTRIBUTION_URL,
  type DisplayCurrency,
} from "@/lib/currency-format";

/**
 * Official brand icon + color for well-known platform `ServiceGroup`s
 * (Phase 4 visual-polish follow-up). Keyed by a lowercased, trimmed group
 * name so it matches regardless of how an admin capitalizes it in the
 * admin panel. Falls back to the group's own emoji `icon` field (or the
 * generic `Layers` icon) for anything not in this map — this is
 * deliberately NOT exhaustive; it only covers platforms this project
 * actually ships services for today (see `models/ServiceGroup.ts` seed
 * data / admin-created groups), plus a handful of common extras so newly
 * added groups have a reasonable chance of getting a real brand mark
 * without a code change.
 */
const PLATFORM_BRAND_ICONS: Record<
  string,
  { Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string }
> = {
  telegram: { Icon: SiTelegram, color: "#26A5E4" },
  instagram: { Icon: SiInstagram, color: "#E4405F" },
  tiktok: { Icon: SiTiktok, color: "#FFFFFF" },
  youtube: { Icon: SiYoutube, color: "#FF0000" },
  facebook: { Icon: SiFacebook, color: "#1877F2" },
  twitter: { Icon: SiX, color: "#FFFFFF" },
  x: { Icon: SiX, color: "#FFFFFF" },
  spotify: { Icon: SiSpotify, color: "#1DB954" },
  twitch: { Icon: SiTwitch, color: "#9146FF" },
  discord: { Icon: SiDiscord, color: "#5865F2" },
  snapchat: { Icon: SiSnapchat, color: "#FFFC00" },
  whatsapp: { Icon: SiWhatsapp, color: "#25D366" },
  threads: { Icon: SiThreads, color: "#FFFFFF" },
  pinterest: { Icon: SiPinterest, color: "#BD081C" },
};

function GroupIcon({ name, emoji }: { name: string; emoji: string | null }) {
  const brand = PLATFORM_BRAND_ICONS[name.trim().toLowerCase()];
  if (brand) {
    const { Icon, color } = brand;
    return <Icon className="h-5 w-5 shrink-0" style={{ color }} />;
  }
  if (emoji) return <span className="text-xl leading-none">{emoji}</span>;
  return <Layers className="h-5 w-5 shrink-0 text-blue-500" />;
}


/**
 * Formats a precomputed median-delivery-time estimate (docs/IMPLEMENTATION_PLAN.md
 * Phase 3.3) for display, e.g. "~45 min" or "~3 hr" (translated, e.g. "~৩ ঘণ্টা"
 * in `bn` — Phase 4 i18n follow-up, previously hardcoded English regardless
 * of locale). `null` (no completed orders yet to compute from) renders as
 * nothing rather than a misleading "N/A" that reads like a promise about
 * slowness. Takes the already-resolved `Services` translation function so
 * it can be called from a component that has it in scope, rather than
 * calling `useTranslations` itself (this is a plain helper, not a hook).
 */
function formatEta(minutes: number | null, t: ReturnType<typeof useTranslations<"Services">>): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return t("etaMinutes", { minutes });
  const hours = minutes / 60;
  if (hours < 24) return t("etaHours", { hours: Math.round(hours * 10) / 10 });
  return t("etaDays", { days: Math.round(hours / 24) });
}

/**
 * Public, read-only catalog display (see docs/IMPLEMENTATION_PLAN.md
 * Phase 1.2). Renders the same `ServiceGroup -> Category -> Service` tree
 * the authenticated `/dashboard/services` page renders, but with a
 * "Sign in to order" CTA in place of a working order form — anonymous
 * visitors can browse and see real pricing, but ordering always requires
 * an account.
 *
 * `isLoggedIn` is passed down from the Server Component page (via `auth()`
 * called there, same pattern as `app/page.tsx`) so the CTA can link
 * straight to `/dashboard/services` for an already-authenticated visitor
 * instead of forcing them through `/login` again.
 */
export function ServiceCatalog({
  groups,
  totalServices,
  isLoggedIn,
  displayCurrency = "USD",
  displayRate = null,
}: {
  groups: CatalogGroup[];
  totalServices: number;
  isLoggedIn: boolean;
  /** Locale's default local display currency (Phase 4) — "USD" means no secondary conversion is shown. */
  displayCurrency?: DisplayCurrency;
  /** 1 USD expressed in `displayCurrency`, resolved server-side once per page load; null if unavailable. */
  displayRate?: number | null;
}) {
  const t = useTranslations("Services");
  const [query, setQuery] = useState("");
  const showsConversion = displayCurrency !== "USD" && displayRate !== null;

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;

    return groups
      .map((group) => {
        const categories = group.categories
          .map((cat) => {
            const services = cat.services.filter(
              (s) => s.name.toLowerCase().includes(q) || cat.name.toLowerCase().includes(q)
            );
            return services.length > 0 ? { ...cat, services } : null;
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);
        return categories.length > 0 ? { ...group, categories } : null;
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [groups, query]);

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-400">
          {t("summary", { count: totalServices, groupCount: groups.length })}
        </p>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-slate-800 bg-slate-900/60 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>

      {filteredGroups.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">
          {t("noMatch", { query })}
        </div>
      )}

      <div className="space-y-12">
        {filteredGroups.map((group) => (
          <section key={group._id ?? "ungrouped"}>
            <div className="mb-4 flex items-center gap-2">
              <GroupIcon name={group.name} emoji={group.icon} />
              <h2 className="text-xl font-bold text-white">{group.name}</h2>
            </div>

            <div className="space-y-8">
              {group.categories.map((cat) => (
                <div key={cat._id} id={cat.slug}>
                  <h3 className="mb-3 text-base font-semibold text-slate-200">{cat.name}</h3>
                  {cat.description && (
                    <p className="mb-3 text-sm text-slate-500">{cat.description}</p>
                  )}
                  <div className="overflow-hidden rounded-xl border border-slate-800">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">{t("colService")}</th>
                          <th className="px-4 py-3 font-medium">{t("colRate")}</th>
                          <th className="px-4 py-3 font-medium">{t("colMin")}</th>
                          <th className="px-4 py-3 font-medium">{t("colMax")}</th>
                          <th className="px-4 py-3 font-medium">{t("colDelivery")}</th>
                          <th className="px-4 py-3 font-medium text-right">{t("colOrder")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {cat.services.map((service) => (
                          <tr key={service._id} className="bg-slate-950/40">
                            <td className="px-4 py-3 text-slate-200">{service.name}</td>
                            <td className="px-4 py-3 text-slate-300">
                              {formatCurrencyAmount(Number(service.rate), "USD")}
                              {showsConversion && (
                                <span className="ml-1.5 text-xs text-slate-500">
                                  ≈ {formatCurrencyAmount(Number(service.rate) * displayRate!, displayCurrency)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-400">{service.minQuantity}</td>
                            <td className="px-4 py-3 text-slate-400">{service.maxQuantity}</td>
                            <td className="px-4 py-3 text-slate-500">
                              {formatEta(service.estimatedDeliveryMinutes, t) ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Link
                                href={isLoggedIn ? "/dashboard/services" : "/login?callbackUrl=/dashboard/services"}
                                className="inline-block rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                              >
                                {isLoggedIn ? t("order") : t("signInToOrder")}
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {showsConversion && (
        <p className="mt-8 text-center text-[11px] text-slate-600">
          {t("conversionNote", { currency: displayCurrency })}{" "}
          <a href={ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-400">
            {ATTRIBUTION_TEXT}
          </a>
        </p>
      )}
    </div>
  );
}
