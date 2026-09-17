import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { forgotPasswordSchema } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { generateRawToken, hashToken } from "@/lib/crypto";
import { sendMail, passwordResetEmailHtml } from "@/lib/mail";
import { env } from "@/lib/env";
import { requestLogger } from "@/lib/logger";

export async function POST(request: Request) {
  const log = requestLogger(request);
  try {
    const ip = getClientIp(request);
    const { success } = await rateLimit("passwordReset", ip);
    if (!success) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

    // Always return the same success response regardless of whether the
    // account exists, to prevent user enumeration.
    if (user) {
      const rawToken = generateRawToken();
      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          purpose: "PASSWORD_RESET",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      const resetLink = `${env.NEXT_PUBLIC_APP_URL}/reset-password?token=${rawToken}`;
      await sendMail({
        to: user.email,
        subject: "Reset your password",
        html: passwordResetEmailHtml(resetLink),
      });
    }

    return NextResponse.json({
      message: "If an account with that email exists, a password reset link has been sent.",
    });
  } catch (error) {
    log.error({ err: error }, "Forgot password error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
