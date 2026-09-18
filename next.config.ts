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
  // Prisma's bundled `dotenv` dependency does an unscoped
  // `fs.existsSync(path.join(process.cwd(), ".env.vault"))` check (and a
  // similar one for `.env`) at require-time. Turbopack's file-tracer can't
  // statically scope that path, so — per its own documented behavior — it
  // falls back to tracing the ENTIRE project into every server function
  // that touches Prisma (i.e. almost every API route here). Verified
  // locally: without this, each of this project's ~90 route functions
  // pulled in ~530 files / ~26MB, including things that must never ship in
  // a deployed function bundle at all (repo docs, markdown, lockfiles,
  // .tsbuildinfo, and Prisma query-engine binaries/wasm for platforms this
  // deployment doesn't run on) — a real contributor to (and very plausibly
  // the actual cause of) Vercel function-size/build failures, not just a
  // cosmetic warning. `outputFileTracingExcludes` is the documented
  // opt-out for exactly this "tracer over-included files" case (see
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
  outputFileTracingExcludes: {
    "*": [
      // Repo docs/notes — never needed at runtime.
      "docs/**",
      "MEMORY.md",
      "CHANGELOG.md",
      "CLAUDE.md",
      "AGENTS.md",
      "README.md",
      // Build/tooling artifacts and lockfiles — never needed at runtime.
      "tsconfig.tsbuildinfo",
      "package-lock.json",
      ".git/**",
      // Everything Claude Code (ECC) vendor/tooling — dev-only, large.
      ".claude/**",
      ".ecc-vendor/**",
      ".agents/**",
      // Test suites and e2e fixtures — never imported by production code.
      "**/__tests__/**",
      "e2e/**",
      // Prisma ships query-engine binaries/wasm for every platform under
      // `generator client`'s binaryTargets; only the one actually running
      // in production (native `debian-openssl-3.0.x`, matching Vercel's
      // Amazon Linux runtime) is needed. Excluding the wasm fallback engine
      // (~2.2MB) and any other-platform binaries alone saves real space
      // across all ~90 functions. Left the actual runtime library files
      // (runtime/library.js etc.) untouched since those ARE needed.
      "lib/generated/prisma/query_engine_bg.wasm",
      "lib/generated/prisma/runtime/*-wasm*.js",
      "lib/generated/prisma/runtime/react-native.js",
      "lib/generated/prisma/runtime/index-browser.js",
    ],
  },
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
