import crypto from "crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requestLogger } from "@/lib/logger";

/**
 * Shared-secret authentication for `GET /api/cron/*` routes
 * (docs/PRODUCTION_READINESS.md §14 — Vercel deployments have no
 * long-lived background-worker process, so `scripts/process-orders.ts` /
 * `poll-order-status.ts` / `compute-delivery-estimates.ts`'s logic is also
 * exposed as these authenticated HTTP endpoints, invoked on a schedule by
 * an external scheduler — see `.github/workflows/cron.yml`).
 *
 * Deliberately the same "shared secret, timing-safe compare, fail closed"
 * shape already used for `TELEGRAM_WEBHOOK_SECRET`
 * (`app/api/telegram/webhook/route.ts` via grammy's `webhookCallback`) —
 * a fresh ad-hoc auth check per route is exactly the kind of copy-paste
 * surface where one route could accidentally get the comparison wrong
 * (e.g. `===` instead of a timing-safe compare, leaking secret length/
 * prefix via response-time side channel), so all three cron routes call
 * this one function instead.
 *
 * Accepts the secret as `Authorization: Bearer <secret>` (the header
 * every external scheduler — GitHub Actions `curl`, cron-job.org, etc. —
 * can trivially send) OR Vercel's own `x-vercel-cron` invocation signal
 * combined with the same bearer header if Vercel Cron is ever enabled
 * later (Pro plan) — see the module doc comment in
 * `app/api/cron/process-orders/route.ts` for why both call sites end up
 * using the identical bearer-token shape either way.
 *
 * Fails closed: if `CRON_SECRET` isn't configured at all (unset in this
 * deployment), every call is rejected — there is no "open" fallback mode,
 * unlike e.g. rate limiting's deliberate in-memory fallback. An
 * unauthenticated cron endpoint that dispatches real provider orders is
 * not an acceptable default in any environment, including local dev
 * (use the CLI scripts directly there instead, per README §11).
 */
export function verifyCronSecret(request: Request): NextResponse | null {
  const secret = env.CRON_SECRET;

  if (!secret) {
    requestLogger(request).error(
      "[cron-auth] CRON_SECRET is not configured — rejecting cron request. " +
        "Set CRON_SECRET to enable the /api/cron/* endpoints."
    );
    return NextResponse.json({ error: "Cron endpoints are not configured." }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);

  // timingSafeEqual throws if buffer lengths differ, so compare against a
  // same-length dummy first — this MUST NOT let a length mismatch short-
  // circuit into skipping the timingSafeEqual call itself (`&&` would do
  // exactly that), since skipping it is itself a timing side-channel that
  // leaks whether the provided secret's length was correct.
  const lengthMatches = actual.length === expected.length;
  const comparableActual = lengthMatches ? actual : expected;
  const buffersEqual = crypto.timingSafeEqual(expected, comparableActual);
  const isValid = lengthMatches && buffersEqual;

  if (!isValid) {
    requestLogger(request).warn("[cron-auth] Rejected cron request with missing/invalid secret.");
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}
