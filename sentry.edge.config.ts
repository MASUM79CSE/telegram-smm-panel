import * as Sentry from "@sentry/nextjs";

/**
 * Edge-runtime Sentry initialization — loaded by `instrumentation.ts`'s
 * `register()` when `NEXT_RUNTIME === "edge"`. This project's `proxy.ts`
 * explicitly documents itself as "Edge-safe... to keep it portable" even
 * though it runs on the Node.js runtime by default under Next 16 (see
 * that file's own header comment) — this config exists so error capture
 * still works correctly if that ever changes, or for any other edge
 * runtime code Next.js introduces. See `instrumentation-client.ts` for
 * the shared rationale behind `dsn`/`enabled`/`tracesSampleRate`.
 */
const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
});
