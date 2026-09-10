/**
 * Whether a pathname should go through next-intl's locale-routing
 * middleware, vs. being treated as a bypass path handled directly by
 * `proxy.ts` (no locale prefix, no next-intl rewrite).
 *
 * `/admin/**` and `/api/**` are deliberately excluded (see `proxy.ts`'s
 * module doc comment — `/admin` is English-only back-office tooling,
 * `/api` is machine-to-machine and never locale-prefixed). `/monitoring`
 * is also excluded: it's Sentry's browser-SDK tunnel route (`tunnelRoute:
 * "/monitoring"` in next.config.ts — routes error/performance events
 * through this app's own domain instead of directly to Sentry's ingest
 * endpoint, to avoid ad-blockers). Without this exclusion next-intl's
 * locale middleware intercepts it like any other page path and 404s
 * (verified live during development: `curl -I http://localhost:3000/
 * monitoring` returned 404 before this fix, `Link: rel="alternate"`
 * locale headers included, confirming next-intl handled it instead of
 * Sentry's route). It has no locale variants and isn't a real page, so it
 * belongs in the same bypass group as `/admin`/`/api`, not the
 * locale-routed surface.
 *
 * Deliberately kept in its own module (imported by `proxy.ts`, not
 * inlined there) so it can be unit-tested directly in
 * `lib/__tests__/proxy-locale-bypass.test.ts` without needing to import
 * `proxy.ts` itself — that file also imports `next-auth`, which pulls in
 * `next/server` in a way Vitest's module resolution can't currently
 * handle standalone (see that test file's comment for the exact error).
 */
export function isLocaleRoutedPath(pathname: string): boolean {
  return !pathname.startsWith("/admin") && !pathname.startsWith("/api") && !pathname.startsWith("/monitoring");
}
