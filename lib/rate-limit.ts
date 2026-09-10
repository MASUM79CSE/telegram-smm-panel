import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Production-grade rate limiting via Upstash Redis (works across serverless
 * instances). Falls back to an in-memory limiter for local development when
 * Upstash credentials aren't configured — clearly logged so it's never
 * silently relied upon in production.
 */

type LimitResult = { success: boolean; remaining: number; reset: number };

const memoryStore = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || entry.resetAt < now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1, reset: now + windowMs };
  }

  entry.count += 1;
  const success = entry.count <= limit;
  return { success, remaining: Math.max(0, limit - entry.count), reset: entry.resetAt };
}

let redisLimiters: Record<string, Ratelimit> | null = null;

function getRedis(): Redis | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
}

const configs = {
  // name: [limit, window in seconds]
  //
  // `login` is deliberately more generous than a naive "5 per minute"
  // brute-force-textbook default: it is keyed by IP (see
  // `auth.ts`->`lib/auth/authorize.ts`), and the PER-ACCOUNT lockout in
  // that same file (5 failed attempts -> 15-minute lock, independent of
  // this limiter) already stops anyone brute-forcing ONE specific
  // account. This IP-level limit exists purely to catch high-volume
  // automated credential-stuffing floods (many different accounts tried
  // rapidly from one IP), so it needs enough headroom that ordinary
  // legitimate traffic sharing one IP — an office/university NAT gateway,
  // a household, a VPN exit node, or just one real person plus a few
  // mistyped passwords across a couple of accounts in a short window —
  // never gets collaterally locked out. (Discovered empirically: an
  // earlier, tighter `[5, 60]` value broke Playwright's own end-to-end
  // suite, e2e/order-flow.e2e.ts, which legitimately logs in as three
  // different seeded accounts across its test run from one IP — a
  // realistic stand-in for exactly this kind of shared-IP, multi-account
  // legitimate traffic pattern.)
  login: [20, 60 * 5],
  register: [3, 60 * 10],
  passwordReset: [3, 60 * 15],
  orderCreate: [20, 60],
  paymentSubmit: [10, 60 * 5],
  ticketCreate: [5, 60 * 10],
  ticketReply: [30, 60],
  apiGeneral: [60, 60],
  telegramLink: [5, 60 * 10],
  telegramBotAction: [30, 60],
  apiKeyCreate: [5, 60 * 10],
  // Self-service order refill (docs/IMPLEMENTATION_PLAN.md Phase 3.1) — a
  // customer legitimately has very few completed, refill-eligible orders to
  // request against at once, so a tight limit is appropriate (also guards
  // against hammering an upstream provider's own refill endpoint).
  orderRefill: [10, 60 * 10],
  // Reseller API v2 (docs/IMPLEMENTATION_PLAN.md Phase 2.2). Rate-limited by
  // the caller's API key id, NOT by IP — a real reseller integration makes
  // many rapid calls from one server, so an IP-based limit would either be
  // too strict for a legitimate high-volume reseller or (if set loose enough
  // to accommodate one) too loose to protect the platform from a single bad
  // actor sharing an IP with other resellers. Generous limit (per-key, not
  // per-IP) since `services`/`balance`/`status` polling is a normal,
  // expected usage pattern for this class of API.
  apiV2: [120, 60],
} as const;

export type RateLimitName = keyof typeof configs;

export async function rateLimit(name: RateLimitName, identifier: string): Promise<LimitResult> {
  const [limit, windowSeconds] = configs[name];
  const redis = getRedis();

  if (!redis) {
    if (env.NODE_ENV === "production") {
      logger.warn(
        "[rate-limit] Upstash Redis not configured — using in-memory fallback in PRODUCTION. " +
          "This does not work correctly across multiple server instances. Set UPSTASH_REDIS_REST_URL/TOKEN."
      );
    }
    return memoryLimit(`${name}:${identifier}`, limit, windowSeconds * 1000);
  }

  if (!redisLimiters) redisLimiters = {};
  if (!redisLimiters[name]) {
    redisLimiters[name] = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
      prefix: `ratelimit:${name}`,
    });
  }

  const result = await redisLimiters[name].limit(identifier);
  return { success: result.success, remaining: result.remaining, reset: result.reset };
}

/** Extracts a best-effort client IP from a NextRequest for rate-limit keys. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
