import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { serviceProviderSchema } from "@/lib/validation";
import { toDecimal128 } from "@/lib/money";
import { recordAudit } from "@/lib/audit";

/**
 * Per-service `ServiceProvider` link management (docs/IMPLEMENTATION_PLAN.md
 * Phase 2.1). Scoped under `/api/admin/services/[id]/providers` rather than
 * a flat `/api/admin/service-providers` — every meaningful operation here
 * (list/create) is naturally scoped to one `Service`, following the same
 * nested-resource shape already used for `/api/support/tickets/[id]/messages`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const links = await prisma.serviceProvider.findMany({
    where: { serviceId: id },
    include: { provider: { select: { name: true, type: true, status: true } } },
    orderBy: { priority: "asc" },
  });

  return NextResponse.json({ links });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: serviceId } = await params;

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = serviceProviderSchema.safeParse({ ...body, serviceId });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const provider = await prisma.provider.findUnique({ where: { id: parsed.data.providerId } });
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 400 });
  }

  const existing = await prisma.serviceProvider.findFirst({
    where: { serviceId, providerId: parsed.data.providerId },
  });
  if (existing) {
    return NextResponse.json(
      { error: "This provider is already linked to this service. Edit the existing link instead." },
      { status: 409 }
    );
  }

  const link = await prisma.serviceProvider.create({
    data: {
      serviceId,
      providerId: parsed.data.providerId,
      providerServiceId: parsed.data.providerServiceId,
      providerRate: toDecimal128(parsed.data.providerRate),
      priority: parsed.data.priority ?? 0,
      active: parsed.data.active ?? true,
    },
  });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_PROVIDER_LINK_CREATED",
    targetType: "ServiceProvider",
    targetId: link.id,
    metadata: { serviceId, providerId: parsed.data.providerId },
    request,
  });

  return NextResponse.json({ message: "Provider linked", link }, { status: 201 });
}
