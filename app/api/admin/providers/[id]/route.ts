import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Provider } from "@/models/Provider";
import { providerSchema } from "@/lib/validation";
import { encryptSecret } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { Service } from "@/models/Service";
import { ServiceProvider } from "@/models/ServiceProvider";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const { id } = await params;

  const body = await request.json();
  const parsed = providerSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { apiKey, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest };
  if (apiKey) {
    update.apiKeyEncrypted = encryptSecret(apiKey);
  }

  const provider = await Provider.findByIdAndUpdate(id, update, { returnDocument: "after" });
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "PROVIDER_UPDATED",
    targetType: "Provider",
    targetId: id,
    request,
  });

  const safe = provider.toObject();
  delete (safe as { apiKeyEncrypted?: unknown }).apiKeyEncrypted;

  return NextResponse.json({ message: "Provider updated", provider: safe });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const { id } = await params;

  // Check BOTH the legacy single-provider link on Service and the
  // Phase 2.1 multi-provider ServiceProvider links — a provider can be
  // referenced either way, and checking only Service.providerId would let
  // a provider still actively linked via ServiceProvider be deleted out
  // from under a live dispatch fallback chain (found during Phase 2.1
  // review, fixed before it could cause an orphaned-reference bug).
  const [serviceCount, serviceProviderCount] = await Promise.all([
    Service.countDocuments({ providerId: id }),
    ServiceProvider.countDocuments({ providerId: id }),
  ]);
  if (serviceCount > 0 || serviceProviderCount > 0) {
    const parts = [];
    if (serviceCount > 0) parts.push(`${serviceCount} service(s) via legacy link`);
    if (serviceProviderCount > 0) parts.push(`${serviceProviderCount} service link(s) via ServiceProvider`);
    return NextResponse.json(
      { error: `Cannot delete: still referenced by ${parts.join(" and ")}.` },
      { status: 400 }
    );
  }

  const provider = await Provider.findByIdAndDelete(id);
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "PROVIDER_DELETED",
    targetType: "Provider",
    targetId: id,
    request,
  });

  return NextResponse.json({ message: "Provider deleted" });
}
