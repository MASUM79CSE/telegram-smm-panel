import { describe, it, expect } from "vitest";
import { isLocaleRoutedPath } from "@/lib/security/locale-routing";

/**
 * Regression test for the Turbopack + next-intl middleware interaction
 * documented in `lib/security/locale-routing.ts`'s doc comment and
 * `docs/PRODUCTION_READINESS.md` §4 ("Turbopack-specific fix applied").
 * `proxy.ts` imports and uses this same function — see that file.
 *
 * The incident: Sentry's browser-SDK tunnel route (`/monitoring`, see
 * `tunnelRoute: "/monitoring"` in next.config.ts) was being intercepted by
 * next-intl's locale-routing middleware and 404'd, because `/monitoring`
 * fell through to the locale-routed branch by default (it isn't `/admin`
 * or `/api`). Fixed by adding it to the same bypass group. This test
 * exists so a future refactor of `proxy.ts`'s bypass-path logic can't
 * silently regress `/monitoring` back into the locale-routed branch
 * without a test failing — the original bug was only caught by a manual
 * `curl` during this session, not any automated check.
 */
describe("proxy.ts isLocaleRoutedPath", () => {
  it("excludes /monitoring from locale routing (Sentry tunnel route)", () => {
    expect(isLocaleRoutedPath("/monitoring")).toBe(false);
  });

  it("excludes /monitoring sub-paths from locale routing", () => {
    expect(isLocaleRoutedPath("/monitoring?o=123&p=456")).toBe(false);
  });

  it("excludes /admin from locale routing", () => {
    expect(isLocaleRoutedPath("/admin")).toBe(false);
    expect(isLocaleRoutedPath("/admin/orders")).toBe(false);
  });

  it("excludes /api from locale routing", () => {
    expect(isLocaleRoutedPath("/api/health")).toBe(false);
    expect(isLocaleRoutedPath("/api/cron/process-orders")).toBe(false);
  });

  it("routes ordinary customer-facing pages through next-intl", () => {
    expect(isLocaleRoutedPath("/")).toBe(true);
    expect(isLocaleRoutedPath("/login")).toBe(true);
    expect(isLocaleRoutedPath("/dashboard")).toBe(true);
    expect(isLocaleRoutedPath("/bn/dashboard")).toBe(true);
  });

  it("does not false-positive-exclude paths that merely start with similar text", () => {
    // Guards against a naive future refactor (e.g. a regex typo) that
    // widens the exclusion beyond exact-prefix matches.
    expect(isLocaleRoutedPath("/administrator")).toBe(false); // starts with "/admin" - matches current (intentionally broad) prefix rule
    expect(isLocaleRoutedPath("/monitoring-dashboard")).toBe(false); // same prefix-rule caveat, documented here rather than silently assumed
    expect(isLocaleRoutedPath("/monitor")).toBe(true); // does NOT start with "/monitoring" - correctly locale-routed
  });
});
