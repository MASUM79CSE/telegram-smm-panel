import { NextResponse } from "next/server";
import { z } from "zod";

import { connectDB } from "@/lib/db";
import { VerificationToken } from "@/models/VerificationToken";
import { User } from "@/models/User";
import { hashToken } from "@/lib/crypto";
import { requestLogger } from "@/lib/logger";

const schema = z.object({ token: z.string().min(1) });

export async function POST(request: Request) {
  const log = requestLogger(request);
  try {
    await connectDB();

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const tokenHash = hashToken(parsed.data.token);

    const record = await VerificationToken.findOne({
      tokenHash,
      purpose: "EMAIL_VERIFY",
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!record) {
      return NextResponse.json({ error: "This verification link is invalid or has expired." }, { status: 400 });
    }

    await User.findByIdAndUpdate(record.userId, { emailVerified: new Date() });

    record.usedAt = new Date();
    await record.save();

    return NextResponse.json({ message: "Email verified successfully." });
  } catch (error) {
    log.error({ err: error }, "Email verification error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
