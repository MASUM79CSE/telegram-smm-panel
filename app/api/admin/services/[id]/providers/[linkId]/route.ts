import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { ServiceProvider } from "@/models/ServiceProvider";
import { serviceProviderSchema } from "@/lib/validation";
import { toDecimal128 } from "@/lib/money";
import { recordAudit } from "@/lib/audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const { id: serviceId, linkId } = await params;

  const body = await request.json();
  const parsed = serviceProviderSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { providerRate, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest };
  if (providerRate !== undefined) {
    update.providerRate = toDecimal128(providerRate);
  }
  // serviceId/providerId are immutable on an existing link — delete and
  // recreate instead of repointing a link, to keep the unique
  // (serviceId, providerId) index meaningful and avoid silently merging
  // two distinct provider relationships.
  delete update.serviceId;
  delete update.providerId;

  const link = await ServiceProvider.findOneAndUpdate({ _id: linkId, serviceId }, update, {
    returnDocument: "after",
  });
  if (!link) {
    return NextResponse.json({ error: "Provider link not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_PROVIDER_LINK_UPDATED",
    targetType: "ServiceProvider",
    targetId: linkId,
    request,
  });

  return NextResponse.json({ message: "Provider link updated", link });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const { id: serviceId, linkId } = await params;

  const link = await ServiceProvider.findOneAndDelete({ _id: linkId, serviceId });
  if (!link) {
    return NextResponse.json({ error: "Provider link not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_PROVIDER_LINK_DELETED",
    targetType: "ServiceProvider",
    targetId: linkId,
    request,
  });

  return NextResponse.json({ message: "Provider link removed" });
}
