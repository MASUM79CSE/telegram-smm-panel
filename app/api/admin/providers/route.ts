import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { providerSchema } from "@/lib/validation";
import { encryptSecret } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // apiKeyEncrypted is omitted here — never returned to the admin list view.
  const providers = await prisma.provider.findMany({
    orderBy: { createdAt: "desc" },
    omit: { apiKeyEncrypted: true },
  });
  return NextResponse.json({ providers });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = providerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { apiKey, ...rest } = parsed.data;

  const provider = await prisma.provider.create({
    data: {
      ...rest,
      apiKeyEncrypted: apiKey ? encryptSecret(apiKey) : null,
    },
    omit: { apiKeyEncrypted: true },
  });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "PROVIDER_CREATED",
    targetType: "Provider",
    targetId: provider.id,
    request,
  });

  return NextResponse.json({ message: "Provider created", provider }, { status: 201 });
}
