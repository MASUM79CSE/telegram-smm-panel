import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { serviceGroupSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const body = await request.json();
  const parsed = serviceGroupSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const group = await prisma.serviceGroup.update({ where: { id }, data: parsed.data }).catch(() => null);
  if (!group) {
    return NextResponse.json({ error: "Service group not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_GROUP_UPDATED",
    targetType: "ServiceGroup",
    targetId: id,
    request,
  });

  return NextResponse.json({ message: "Service group updated", group });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const categoryCount = await prisma.category.count({ where: { groupId: id } });
  if (categoryCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete: ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"} still ${
          categoryCount === 1 ? "belongs" : "belong"
        } to this group.`,
      },
      { status: 400 }
    );
  }

  const group = await prisma.serviceGroup.delete({ where: { id } }).catch(() => null);
  if (!group) {
    return NextResponse.json({ error: "Service group not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_GROUP_DELETED",
    targetType: "ServiceGroup",
    targetId: id,
    request,
  });

  return NextResponse.json({ message: "Service group deleted" });
}
