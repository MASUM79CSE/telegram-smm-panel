import { z } from "zod";
import { logger } from "@/lib/logger";

/**
 * Centralized, validated environment configuration.
 * Fail fast at startup if required secrets are missing/weak instead of
 * discovering it in production via a cryptic runtime error.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),

  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters. Generate with: openssl rand -base64 32"),

  NEXTAUTH_URL: z.string().url().optional(),
  /**
   * Auth.js only auto-trusts the request's Host header when NODE_ENV !==
   * "production" (i.e. always in local dev). In production this must be
   * "true" (typical when behind a reverse proxy/load balancer that already
   * validates Host) or every auth-related request — sign-in, session
   * lookup, proxy.ts route protection — fails with "UntrustedHost".
   * NEXTAUTH_URL does NOT satisfy this on its own (verified: it only
   * overrides the request URL, it does not set trustHost) — this is easy
   * to miss because it never reproduces in local development. See README
   * §11 (Production Setup).
   */
  AUTH_TRUST_HOST: z.coerce.boolean().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  /** Verifies incoming webhook requests really come from Telegram (X-Telegram-Bot-Api-Secret-Token). */
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  /** Public bot username (no @), e.g. "MyPanelBot" — used to build the deep-link shown on the dashboard. */
  TELEGRAM_BOT_USERNAME: z.string().optional(),

  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),

  // --- Error tracking / performance monitoring (docs/PRODUCTION_READINESS.md §4/§6) ---
  // Both optional: every Sentry init call in this codebase checks for the
  // DSN being present and no-ops otherwise (see sentry.server.config.ts /
  // sentry.edge.config.ts / instrumentation-client.ts), so local dev, CI,
  // and any deployment that hasn't set up a Sentry project yet keep
  // working exactly as before — this is strictly additive.
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  // Only needed to upload source maps at build time (better stack traces in
  // Sentry) — safe to omit; the app and error capture work without it, you
  // just see minified stack traces in the Sentry UI instead of original TS.
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),

  // --- Cron endpoint auth (docs/PRODUCTION_READINESS.md §14) ---
  // Shared secret the external scheduler (see .github/workflows/cron.yml)
  // sends as `Authorization: Bearer <CRON_SECRET>` to authenticate calls to
  // GET /api/cron/* — same "timing-safe shared secret" pattern already
  // used for TELEGRAM_WEBHOOK_SECRET (lib/security/cron-auth.ts).
  CRON_SECRET: z.string().optional(),
});


export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    throw new Error(
      `\n\n❌ Invalid environment configuration:\n${issues}\n\nCheck your .env / .env.local against .env.example\n`
    );
  }

  if (parsed.data.NODE_ENV === "production" && parsed.data.AUTH_SECRET.includes("replace_with")) {
    throw new Error("AUTH_SECRET is still the placeholder value. Set a real secret before deploying.");
  }

  if (parsed.data.NODE_ENV === "production" && !parsed.data.AUTH_TRUST_HOST) {
    logger.warn(
      "[env] AUTH_TRUST_HOST is not set to \"true\" in production. Auth.js only " +
        "auto-trusts the request Host header outside production, so every auth-related " +
        "request (sign-in, session lookup, proxy.ts route protection) will fail with an " +
        "\"UntrustedHost\" error. NEXTAUTH_URL alone does NOT fix this — it only overrides " +
        "the request URL, it does not set trustHost. Set AUTH_TRUST_HOST=true (safe when " +
        "behind a reverse proxy/load balancer that already validates Host, which is the " +
        "common deployment shape) before going live."
    );
  }

  if (parsed.data.NODE_ENV === "production" && !parsed.data.CRON_SECRET) {
    logger.warn(
      "[env] CRON_SECRET is not set in production. GET /api/cron/* routes will reject every " +
        "request (fail closed, by design — see lib/security/cron-auth.ts), so order processing, " +
        "status polling, and delivery-estimate computation will NOT run unless you're instead " +
        "running the scripts/*.ts CLI workers as long-lived processes (systemd/pm2/Docker). Set " +
        "CRON_SECRET and configure your scheduler (see .github/workflows/cron.yml) before relying " +
        "on the serverless cron-endpoint path."
    );
  }

  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
