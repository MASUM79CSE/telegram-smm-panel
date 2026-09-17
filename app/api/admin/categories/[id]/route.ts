import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { categorySchema } from "@/lib/validation";
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
  const parsed = categorySchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const update: typeof parsed.data = { ...parsed.data };
  if ("groupId" in update) {
    if (update.groupId) {
      const exists = await prisma.serviceGroup.findUnique({ where: { id: update.groupId }, select: { id: true } });
      if (!exists) {
        return NextResponse.json({ error: "Service group not found" }, { status: 400 });
      }
    } else {
      update.groupId = null;
    }
  }

  const category = await prisma.category.update({ where: { id }, data: update }).catch(() => null);
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "CATEGORY_UPDATED",
    targetType: "Category",
    targetId: id,
    request,
  });

  return NextResponse.json({ message: "Category updated", category });
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

  const serviceCount = await prisma.service.count({ where: { categoryId: id } });
  if (serviceCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${serviceCount} service(s) still belong to this category.` },
      { status: 400 }
    );
  }

  const category = await prisma.category.delete({ where: { id } }).catch(() => null);
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "CATEGORY_DELETED",
    targetType: "Category",
    targetId: id,
    request,
  });

  return NextResponse.json({ message: "Category deleted" });
}
