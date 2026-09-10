import { compare } from "bcryptjs";

import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { recordAudit } from "@/lib/audit";
import { loginSchema } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * The NextAuth Credentials provider's actual login logic, extracted into
 * its own module (rather than inlined in `auth.ts`'s `Credentials({...})`
 * config) for exactly one reason: `auth.ts` calls `NextAuth(...)` at
 * module scope, which transitively imports `next/server` — that import
 * fails outright under Vitest's plain Node test environment (confirmed:
 * `Cannot find module '.../node_modules/next/server' imported from
 * next-auth/lib/env.js`), making `auth.ts` itself unimportable from a
 * fast unit test. Keeping this logic in a NextAuth-independent module
 * lets `lib/__tests__/auth-authorize.test.ts` import and exercise it
 * directly. `auth.ts` re-exports it unchanged as the Credentials
 * provider's `authorize` callback — behavior is identical either way.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<"email" | "password", unknown>>,
  request: Request
) {
  // IP-based rate limiting — independent of, and in addition to, the
  // per-account lockout further down. The `login` entry in
  // lib/rate-limit.ts's `configs` existed since that module's original
  // design but was never actually wired up anywhere (verified by grep
  // across the whole codebase before this fix) — meaning a single IP
  // could attempt unlimited logins against unlimited different email
  // addresses (credential stuffing) with no rate limit at all, since the
  // account-level lockout below only kicks in after repeated failures
  // against the SAME account. This closes that gap: 5 attempts per 60
  // seconds per IP, matching the limit already defined (and already
  // documented in docs/PRODUCTION_READINESS.md's rate-limiting section)
  // but never enforced.
  const ip = getClientIp(request);
  const { success } = await rateLimit("login", ip);
  if (!success) return null;

  // `loginSchema` (from lib/validation.ts) trims and lowercases the email
  // before validating it as an email address. This module used to have
  // its own hand-rolled schema that skipped both steps, so a stray
  // leading/trailing space — extremely common from browser autofill,
  // password managers, or copy/pasting an email address — meant the
  // exact-match `User.findOne({ email })` lookup below never matched an
  // otherwise-correct, existing account, always producing the generic
  // "Invalid email or password" error even though the account and
  // password were both fine.
  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) return null;

  const { email, password } = parsed.data;

  await connectDB();

  const user = await User.findOne({ email }).select(
    "+passwordHash name email role status failedLoginAttempts lockedUntil"
  );

  if (!user || !user.passwordHash) {
    // Constant-time-ish: still run a compare against a dummy hash to
    // reduce user-enumeration timing signal.
    await compare(password, "$2a$12$invalidsaltinvalidsaltinvalidsaltinva");
    return null;
  }

  // Account lockout check
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return null;
  }

  if (user.status !== "ACTIVE") {
    return null;
  }

  const valid = await compare(password, user.passwordHash);

  if (!valid) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= LOCKOUT_THRESHOLD) {
      user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    }
    await user.save();

    await recordAudit({
      actorEmail: email,
      action: "LOGIN_FAILED",
      targetType: "User",
      targetId: user._id.toString(),
    });

    return null;
  }

  // Successful login — reset lockout counters
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  await recordAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: "LOGIN_SUCCESS",
    targetType: "User",
    targetId: user._id.toString(),
  });

  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
  };
}
