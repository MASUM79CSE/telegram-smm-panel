import { NextResponse } from "next/server";
import { hash } from "bcryptjs";

import { prisma } from "@/lib/db";
import { registerSchema } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { generateRawToken, hashToken } from "@/lib/crypto";
import { sendMail, verificationEmailHtml } from "@/lib/mail";
import { getSettings } from "@/lib/services/settings";
import { env } from "@/lib/env";
import { requestLogger } from "@/lib/logger";

export async function POST(request: Request) {
  const log = requestLogger(request);
  try {
    const ip = getClientIp(request);
    const { success } = await rateLimit("register", ip);
    if (!success) {
      return NextResponse.json({ error: "Too many registration attempts. Please try again later." }, { status: 429 });
    }

    const settings = await getSettings();
    if (!settings.registrationEnabled) {
      return NextResponse.json({ error: "Registration is currently disabled." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Avoid confirming account existence in the message wording, but the
      // 409 status is still needed for the client to react correctly.
      return NextResponse.json({ error: "Unable to register with these details." }, { status: 409 });
    }

    const passwordHash = await hash(password, 12);

    const user = await prisma.user.create({
      data: { name, email, passwordHash },
    });

    await prisma.wallet.create({ data: { userId: user.id, balance: 0, currency: "USD" } });

    // Email verification token
    const rawToken = generateRawToken();
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        purpose: "EMAIL_VERIFY",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const verifyLink = `${env.NEXT_PUBLIC_APP_URL}/verify-email?token=${rawToken}`;
    await sendMail({
      to: user.email,
      subject: "Verify your email address",
      html: verificationEmailHtml(verifyLink),
    });

    return NextResponse.json(
      {
        message: "Account created. Please check your email to verify your account.",
        user: { id: user.id, email: user.email, name: user.name },
      },
      { status: 201 }
    );
  } catch (error) {
    log.error({ err: error }, "Registration error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
