import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { requestLogger } from "@/lib/logger";

const schema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  const log = requestLogger(request);
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const tokenHash = hashToken(parsed.data.token);

    const record = await prisma.verificationToken.findFirst({
      where: {
        tokenHash,
        purpose: "EMAIL_VERIFY",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!record) {
      return NextResponse.json({ error: "This verification link is invalid or has expired." }, { status: 400 });
    }

    await prisma.user.update({ where: { id: record.userId }, data: { emailVerified: new Date() } });

    await prisma.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    return NextResponse.json({ message: "Email verified successfully." });
  } catch (error) {
    log.error({ err: error }, "Email verification error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
