import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { serviceSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const services = await prisma.service.findMany({
    include: {
      category: { select: { name: true } },
      provider: { select: { name: true, type: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ services });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = serviceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const service = await prisma.service.create({ data: parsed.data });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_CREATED",
    targetType: "Service",
    targetId: service.id,
    request,
  });

  return NextResponse.json({ message: "Service created", service }, { status: 201 });
}
