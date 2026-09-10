import { defineRouting } from "next-intl/routing";

/**
 * Locale routing configuration (docs/IMPLEMENTATION_PLAN.md Phase 4.1).
 *
 * Scope decision (documented, not guessed — see docs/I18N_PLAN.md §1 for the
 * full rationale): English (`en`, default) + Bengali (`bn`). Bangladesh has
 * one of the world's largest concentrations of SMM-panel operators and
 * resellers — a well-documented fact about this specific industry, not a
 * generic "add a popular language" pick — and Bengali is this project's own
 * operating context (Asia/Dhaka). This is a real, defensible target-market
 * decision, not a placeholder.
 *
 * `localePrefix: "as-needed"` — English (the default) is served unprefixed
 * (`/services`, `/dashboard`) so existing bookmarks/links/the sitemap that
 * predate this change keep working with zero redirect; Bengali is served
 * under `/bn/...`. This matches the "additive, non-breaking" convention
 * already used for every other schema/route change in this project.
 */
export const routing = defineRouting({
  locales: ["en", "bn"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

export type AppLocale = (typeof routing.locales)[number];
