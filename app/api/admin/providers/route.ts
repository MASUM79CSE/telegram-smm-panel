import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Provider } from "@/models/Provider";
import { providerSchema } from "@/lib/validation";
import { encryptSecret } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  // apiKeyEncrypted has select:false on the schema, so it's never returned here.
  const providers = await Provider.find().sort({ createdAt: -1 }).lean();
  return NextResponse.json({ providers });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const body = await request.json();
  const parsed = providerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { apiKey, ...rest } = parsed.data;

  const provider = await Provider.create({
    ...rest,
    apiKeyEncrypted: apiKey ? encryptSecret(apiKey) : null,
  });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "PROVIDER_CREATED",
    targetType: "Provider",
    targetId: provider._id.toString(),
    request,
  });

  // Strip sensitive field defensively even though select:false already hides it.
  const safe = provider.toObject();
  delete (safe as { apiKeyEncrypted?: unknown }).apiKeyEncrypted;

  return NextResponse.json({ message: "Provider created", provider: safe }, { status: 201 });
}
