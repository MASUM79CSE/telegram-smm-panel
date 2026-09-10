import { NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { changePasswordSchema } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { requestLogger } from "@/lib/logger";

/**
 * Self-service password change (docs/DASHBOARD_UPGRADE_PLAN.md §3.3).
 * Requires re-entering the current password (standard practice for a
 * change made from within an already-authenticated session, distinct from
 * the token-based `/api/reset-password` flow used when a user is locked
 * out). Rate-limited per account+IP to slow down someone who has hijacked
 * a session and is trying to lock the real owner out by rotating the
 * password repeatedly, or brute-forcing the current-password check.
 */
export async function POST(request: Request) {
  const log = requestLogger(request);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(request);
    const { success } = await rateLimit("passwordReset", `change-password:${session.user.id}:${ip}`);
    if (!success) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    await connectDB();

    const user = await User.findById(session.user.id).select("+passwordHash");
    if (!user || !user.passwordHash) {
      // No password set (e.g. a hypothetical future OAuth-only account) —
      // there is nothing to "change" via this current-password-gated flow.
      return NextResponse.json({ error: "Unable to change password for this account." }, { status: 400 });
    }

    const valid = await compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }

    user.passwordHash = await hash(parsed.data.newPassword, 12);
    await user.save();

    await recordAudit({
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "PASSWORD_CHANGED_BY_USER",
      targetType: "User",
      targetId: session.user.id,
      request,
    });

    return NextResponse.json({ message: "Password changed successfully." });
  } catch (error) {
    log.error({ err: error }, "Change password error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
