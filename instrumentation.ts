import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook (docs/PRODUCTION_READINESS.md §4/§6) —
 * loads the correct Sentry config for whichever runtime this server
 * process actually is, and wires up server-side request-error capture.
 *
 * Stable (not experimental) as of the Next.js version this project runs
 * (16.3.3) — no `experimental.instrumentationHook` flag needed in
 * `next.config.ts`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown in Server Components, proxy.ts, and other
// server-side rendering paths that don't go through a route handler's own
// try/catch — a safe no-op when Sentry isn't enabled (unconfigured DSN).
export const onRequestError = Sentry.captureRequestError;
