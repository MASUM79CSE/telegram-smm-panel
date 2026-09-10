import * as Sentry from "@sentry/nextjs";

/**
 * Server-side (Node.js runtime) Sentry initialization — see
 * `instrumentation-client.ts` for the full rationale (this file's `dsn`/
 * `enabled`/`tracesSampleRate` choices mirror it exactly, so error
 * tracking and performance monitoring behave consistently whether an
 * error/transaction originates in the browser, an API route, a Server
 * Component, or the Telegram bot's request handling).
 *
 * Loaded by `instrumentation.ts`'s `register()` when `NEXT_RUNTIME ===
 * "nodejs"` — this covers API routes, Server Components, and
 * `proxy.ts`/`app/api/telegram/webhook` (grammy's bot handling runs in
 * this same Node.js runtime, not the edge one).
 */
const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // `lib/logger.ts` already redacts secret-shaped fields (password,
  // apiKey, token, authorization, cookie) from structured logs — apply
  // the same discipline here so a captured exception's request/context
  // data doesn't leak one of those fields to Sentry either.
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
    }
    return event;
  },
});
