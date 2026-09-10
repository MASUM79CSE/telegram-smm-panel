import { NextResponse } from "next/server";
import { hash } from "bcryptjs";

import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { VerificationToken } from "@/models/VerificationToken";
import { resetPasswordSchema } from "@/lib/validation";
import { hashToken } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { requestLogger } from "@/lib/logger";

export async function POST(request: Request) {
  const log = requestLogger(request);
  try {
    await connectDB();

    const body = await request.json();
    const parsed = resetPasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const tokenHash = hashToken(parsed.data.token);

    const record = await VerificationToken.findOne({
      tokenHash,
      purpose: "PASSWORD_RESET",
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!record) {
      return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
    }

    const passwordHash = await hash(parsed.data.password, 12);

    await User.findByIdAndUpdate(record.userId, {
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    record.usedAt = new Date();
    await record.save();

    await recordAudit({
      actorId: record.userId,
      action: "PASSWORD_RESET",
      targetType: "User",
      targetId: record.userId.toString(),
      request,
    });

    return NextResponse.json({ message: "Password reset successfully. You can now log in." });
  } catch (error) {
    log.error({ err: error }, "Reset password error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
