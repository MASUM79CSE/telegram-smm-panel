import { createNavigation } from "next-intl/navigation";
import { routing } from "@/i18n/routing";

/**
 * Locale-aware wrappers around Next.js' navigation APIs. Use these instead
 * of the plain `next/link`/`next/navigation` exports anywhere a link/redirect
 * needs to stay on the current locale (i.e. almost everywhere in customer-
 * facing UI) — see docs/I18N_PLAN.md §3 for the specific exceptions (Server
 * Actions' `redirect()` and API routes keep using plain Next.js APIs, since
 * `next/navigation`'s locale-aware `redirect` only works from within a
 * request that already resolved a `[locale]` segment).
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
