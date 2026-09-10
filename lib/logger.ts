import pino from "pino";
import { REQUEST_ID_HEADER } from "@/lib/security/request-id";

/**
 * Centralized structured logger (closes docs/PRODUCTION_READINESS.md §3).
 *
 * Previously this codebase used plain `console.log`/`console.error`/
 * `console.warn` everywhere (verified by grep across `app/`, `lib/`,
 * `scripts/` before this change) — no log levels beyond what `console.*`
 * implies, no structured (JSON) log format, and no way to tie a chain of
 * log lines back to the one HTTP request or Telegram bot update that
 * produced them. That's fine for `console.error("x failed:", err)`-style
 * debugging locally, but painful once logs are aggregated by a real host
 * (Vercel, Railway, a Docker log driver, CloudWatch, etc.) and you need to
 * filter by severity or correlate 6 log lines from one failed checkout.
 *
 * Design:
 *  - In production (`NODE_ENV=production`), emits newline-delimited JSON
 *    (Pino's default) — this is what every log aggregator expects, and is
 *    also the fastest output mode (Pino's whole design point: near-zero
 *    overhead structured logging, unlike `JSON.stringify`-ing manually).
 *  - In development/test, uses `pino-pretty` for human-readable colorized
 *    output — the same information, easier to read in a terminal.
 *  - `req(request)` / `withRequestId(id)` attach a per-request correlation
 *    id (`reqId`) so every log line emitted while handling one request can
 *    be grep'd/filtered together — see `withLogger()` below, used from
 *    `proxy.ts`, and `lib/logger-request.ts` for the route-handler-facing
 *    helper.
 *  - Deliberately NOT used inside `scripts/*.ts` (one-shot/long-running CLI
 *    tools, e.g. `process-orders.ts`, `seed.ts`) — those keep plain
 *    `console.log` since they're run interactively/by a process manager
 *    that already timestamps output, and pulling in request-correlation
 *    machinery there would add complexity with no real benefit. This
 *    logger is for the two "long-lived server" surfaces: the Next.js HTTP
 *    server (API routes, `proxy.ts`) and the Telegram bot's event loop.
 */

const isProduction = process.env.NODE_ENV === "production";
// Vitest sets NODE_ENV=test; keep test output silent-by-default (no pretty
// transport spawned as a worker thread, which would leak an open handle and
// slow down/flake the test suite) unless a developer explicitly wants logs
// while debugging a failing test (LOG_LEVEL=debug npx vitest run ...).
const isTest = process.env.NODE_ENV === "test";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isTest ? "silent" : "info"),
  // Redact common secret-shaped fields defensively, in case a caller ever
  // accidentally logs a full request/user object that happens to carry one
  // of these keys (defense in depth — call sites should still avoid this).
  redact: {
    paths: [
      "password",
      "passwordHash",
      "*.password",
      "*.passwordHash",
      "authorization",
      "req.headers.authorization",
      "req.headers.cookie",
      "apiKey",
      "*.apiKey",
      "token",
      "*.token",
    ],
    censor: "[redacted]",
  },
  ...(isProduction || isTest
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});

/**
 * Returns a child logger with a `reqId` bound to every subsequent log line,
 * for correlating all log output produced while handling one HTTP request.
 * The id itself is generated once per request in `proxy.ts` (see
 * `lib/security/request-id.ts`) and threaded through as a request header,
 * the same pattern already used for the CSP nonce (`lib/security/csp.ts`).
 */
export function loggerFor(reqId: string | undefined | null) {
  return reqId ? logger.child({ reqId }) : logger;
}

/**
 * Convenience wrapper for API route handlers: pulls the correlation id
 * `proxy.ts` attached to this request (see `lib/security/request-id.ts`)
 * straight off the incoming `Request`/`NextRequest` and returns a logger
 * pre-bound to it. Usage in a route handler:
 *
 *   const log = requestLogger(request);
 *   log.error({ err }, "Orders fetch error");
 */
export function requestLogger(request: Request) {
  return loggerFor(request.headers.get(REQUEST_ID_HEADER));
}

