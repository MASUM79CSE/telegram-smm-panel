import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
// `@sentry/nextjs/config` (not the top-level `@sentry/nextjs` package) is
// the current, non-deprecated import path for `withSentryConfig` — the
// top-level export still works but logs a deprecation warning as of the
// installed SDK version and will be removed in a future major version.
import { withSentryConfig } from "@sentry/nextjs/config";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // Next.js's dev server rejects cross-origin requests to `_next/static`
  // dev assets/HMR by default (see
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).
  // This project is frequently run inside a sandboxed preview (e.g. Arena's
  // Agent Mode / E2B sandboxes) where the browser loads the app from
  // `https://<port>-<sandboxId>.e2b.app`, NOT `localhost` — without this,
  // every JS chunk request from that real preview origin gets a bare `403
  // Forbidden` ("Unauthorized") response, React never hydrates, and every
  // client-side form (login, register, etc.) silently degrades to a native
  // full-page HTML submission with no visible error. `**.e2b.app` covers
  // any sandbox id via the `**` (one-or-more-labels) wildcard. Only added
  // in development — production deployments should rely on their real,
  // fixed domain and don't need this at all.
  ...(process.env.NODE_ENV !== "production"
    ? { allowedDevOrigins: ["localhost", "**.e2b.app"] }
    : {}),
};


const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * `withSentryConfig` wraps the build to upload source maps (readable
 * stack traces in the Sentry UI instead of minified ones) and set up the
 * `/monitoring` tunnel route (routes browser SDK events through this
 * app's own domain instead of directly to Sentry's ingest endpoint,
 * avoiding ad-blockers that block Sentry's raw domain). Safe to leave
 * enabled even when `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`
 * aren't set (docs/PRODUCTION_READINESS.md §4) — the source-map upload
 * step is silently skipped with a build-time notice rather than failing
 * the build, which is exactly the behavior every other optional
 * integration in this codebase already has (verified locally: `npm run
 * build` succeeds with these env vars unset — see that verification note
 * in MEMORY.md).
 */
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppresses noisy source-map-upload logging when no auth token is
  // configured (the common case until the user sets up a real project).
  silent: !process.env.SENTRY_AUTH_TOKEN,

  // Avoids leaking source maps to end users' browsers in production while
  // still uploading them to Sentry for stack-trace symbolication.
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Route browser SDK requests through this app's own /monitoring path
  // rather than directly to Sentry, reducing ad-blocker interference.
  tunnelRoute: "/monitoring",

  // NOTE: this project builds with Turbopack (Next.js 16's default), not
  // webpack — the webpack-only build-time options the Sentry docs mention
  // (`webpack.treeshake.removeDebugLogging`, `webpack.reactComponentAnnotation`,
  // and the older deprecated `disableLogger`/`reactComponentAnnotation`
  // top-level options) don't apply here and are deliberately omitted
  // rather than set-and-silently-ignored. Revisit if this project ever
  // switches off Turbopack.

  // This project has no separate Vercel Cron config yet (see
  // docs/PRODUCTION_READINESS.md §14 — external GitHub Actions scheduler
  // is used instead), so Sentry's automatic Vercel Cron Monitor wiring
  // doesn't apply.
});
