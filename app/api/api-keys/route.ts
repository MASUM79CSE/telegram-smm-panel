import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { ApiKey } from "@/models/ApiKey";
import { apiKeyCreateSchema } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { createApiKey } from "@/lib/services/api-keys";
import { recordAudit } from "@/lib/audit";

/** Customer-facing API key management (docs/IMPLEMENTATION_PLAN.md Phase 2.2). */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const keys = await ApiKey.find({ userId: session.user.id })
    .select("-keyHash")
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({ keys });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { success } = await rateLimit("apiKeyCreate", `${session.user.id}:${ip}`);
  if (!success) {
    return NextResponse.json({ error: "Too many key creation attempts. Please try again later." }, { status: 429 });
  }

  await connectDB();

  const body = await request.json().catch(() => ({}));
  const parsed = apiKeyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const { apiKey, rawKey } = await createApiKey({
    userId: session.user.id,
    label: parsed.data.label,
  });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "API_KEY_CREATED",
    targetType: "ApiKey",
    targetId: apiKey._id.toString(),
    request,
  });

  // The raw key is returned exactly once, here, and is never retrievable
  // again — same convention as the Telegram link code / password reset
  // token: only the hash is persisted.
  return NextResponse.json(
    {
      message: "API key created. Copy it now — it will not be shown again.",
      key: rawKey,
      apiKey: { _id: apiKey._id, label: apiKey.label, keyPrefix: apiKey.keyPrefix, createdAt: apiKey.createdAt },
    },
    { status: 201 }
  );
}
