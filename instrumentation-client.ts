import * as Sentry from "@sentry/nextjs";

/**
 * Client-side (browser) Sentry initialization
 * (docs/PRODUCTION_READINESS.md §4/§6).
 *
 * Also serves §6 (Metrics & Alerting): rather than standing up a second,
 * separate metrics/APM vendor, this project deliberately reuses Sentry's
 * built-in Performance Monitoring (`tracesSampleRate` below) for
 * transaction/latency visibility — same account, same DSN as error
 * tracking, no second SDK/dashboard. See `docs/PRODUCTION_READINESS.md`
 * §6 for the explicit trade-off this represents (it does not replace a
 * general-purpose custom business-metrics pipeline, which is a distinct,
 * larger, not-yet-requested piece of work).
 *
 * A safe no-op when `NEXT_PUBLIC_SENTRY_DSN` isn't set — every environment
 * that hasn't configured a Sentry project yet (local dev, CI, and any
 * production deployment before the user creates one) keeps working exactly
 * as it did before this file existed, matching this project's established
 * "optional integration, graceful no-op when unconfigured" convention
 * (see e.g. `lib/rate-limit.ts`'s Upstash fallback).
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),

  // Capture 100% of transactions in development (cheap, useful for local
  // verification), a much smaller sample in production (real traffic
  // volume makes 100% both expensive and unnecessary for the
  // latency/error-rate visibility this is actually for).
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay deliberately NOT enabled: this app handles wallet
  // balances, payment references, and admin actions on customer accounts
  // — recording user sessions (even masked) adds a real privacy/compliance
  // surface this project hasn't evaluated. Revisit deliberately later if
  // actually needed, rather than defaulting it on via the SDK's own
  // example config.
});

// Required for App Router navigation instrumentation (client-side route
// changes) — a no-op export if tracing is disabled/DSN unset.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
