import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { requestLogger } from "@/lib/logger";

/**
 * Cross-origin request enforcement for `/api/**` routes.
 *
 * `ALLOWED_ORIGINS` previously existed only in `lib/env.ts` with no code
 * actually reading it anywhere — this module is what makes that variable do
 * something. Enforced centrally in `proxy.ts` (runs before every request)
 * rather than duplicated per-route.
 *
 * Deliberately conservative:
 *  - Only applies to `/api/**` — page navigations aren't a CSRF/CORS concern
 *    in the same way a fetch()-based API call is.
 *  - Skips `/api/auth/**` — Auth.js manages its own CSRF-token-based
 *    protection for its own endpoints; double-enforcing here would risk
 *    breaking sign-in and adds no real protection on top.
 *  - Skips `/api/telegram/webhook` — Telegram calls this server-to-server
 *    and never sends a browser `Origin` header; that route is instead
 *    protected by `TELEGRAM_WEBHOOK_SECRET` (see that route's handler).
 *  - Only rejects requests that DO send an `Origin` header that doesn't
 *    match the allow-list. Requests with no `Origin` header (same-origin
 *    top-level navigation, server-to-server calls, curl, the background
 *    worker) are NOT blocked here — this is an anti-cross-origin-browser-
 *    request control, not a general-purpose authentication mechanism, and
 *    every mutating route already independently enforces its own auth/role
 *    checks regardless of origin.
 */
/**
 * Matches a request `Origin` header's hostname against an allow-list entry
 * that may use the same wildcard syntax Next.js's own `allowedDevOrigins`
 * uses (see next.config.ts): a bare hostname for an exact match, `*.foo`
 * for exactly one subdomain label, `**.foo` for one-or-more labels (so any
 * sandbox/tunnel subdomain matches without hardcoding an id).
 */
function hostnameMatches(hostname: string, pattern: string): boolean {
  if (pattern === hostname) return true;

  if (pattern.startsWith("**.")) {
    const suffix = pattern.slice(2); // ".foo.bar"
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }

  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".foo.bar"
    if (!hostname.endsWith(suffix) || hostname.length <= suffix.length) return false;
    const remainder = hostname.slice(0, hostname.length - suffix.length);
    return remainder.length > 0 && !remainder.includes(".");
  }

  return false;
}

export function checkOrigin(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) return null;
  if (pathname.startsWith("/api/auth/")) return null;
  if (pathname.startsWith("/api/telegram/webhook")) return null;

  const origin = request.headers.get("origin");
  if (!origin) return null;

  const allowed = env.ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  let originHostname: string;
  try {
    originHostname = new URL(origin).hostname;
  } catch {
    // Malformed Origin header — fail closed, same as an unrecognized origin.
    originHostname = origin;
  }

  const isAllowed = allowed.some(
    (entry) => entry === origin || hostnameMatches(originHostname, entry)
  );

  if (isAllowed) return null;

  requestLogger(request).warn({ pathname, origin }, "[cors] Rejected request from disallowed origin");

  return NextResponse.json(
    { error: "Cross-origin request not allowed." },
    { status: 403 }
  );
}

