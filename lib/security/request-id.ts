import { nanoid } from "nanoid";

/**
 * Per-request correlation id, generated once in `proxy.ts` for every
 * request and forwarded as a header (same technique already used for the
 * CSP nonce — see `lib/security/csp.ts`'s `NONCE_HEADER`), so route
 * handlers and any service code they call can attach it to log lines via
 * `loggerFor()` (`lib/logger.ts`) and a developer/on-call engineer can grep
 * every log line produced while handling one specific request.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/** Generates a short, URL-safe, non-guessable request id. */
export function generateRequestId(): string {
  return nanoid(12);
}
