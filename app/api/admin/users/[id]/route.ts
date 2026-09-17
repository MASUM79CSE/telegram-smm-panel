import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { userStatusSchema, userRoleSchema } from "@/lib/validation";
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

  if (id === session.user.id) {
    return NextResponse.json({ error: "You cannot modify your own account here." }, { status: 400 });
  }

  const body = await request.json();

  const statusParsed = userStatusSchema.safeParse(body);
  const roleParsed = userRoleSchema.safeParse(body);

  if (!statusParsed.success && !roleParsed.success) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const update: { status?: string; role?: string } = {};
  if (statusParsed.success) update.status = statusParsed.data.status;
  if (roleParsed.success) update.role = roleParsed.data.role;

  const user = await prisma.user
    .update({
      where: { id },
      data: update as { status?: "ACTIVE" | "SUSPENDED" | "BANNED"; role?: "USER" | "ADMIN" },
      omit: { passwordHash: true, twoFactorSecret: true },
    })
    .catch(() => null);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (update.status) {
    await recordAudit({
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "USER_STATUS_CHANGE",
      targetType: "User",
      targetId: id,
      metadata: { newStatus: update.status },
      request,
    });
  }
  if (update.role) {
    await recordAudit({
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "USER_ROLE_CHANGE",
      targetType: "User",
      targetId: id,
      metadata: { newRole: update.role },
      request,
    });
  }

  return NextResponse.json({ message: "User updated", user });
}
