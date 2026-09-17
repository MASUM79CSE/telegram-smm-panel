import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Scoped by BOTH id and userId in one query — a user can only ever
  // revoke their own key, never guess another user's key id and disable
  // it (this is the same "scope every mutation to the owning user, don't
  // rely on the id alone" discipline used throughout this project).
  const result = await prisma.apiKey.updateMany({
    where: { id, userId: session.user.id },
    data: { active: false },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "API_KEY_REVOKED",
    targetType: "ApiKey",
    targetId: id,
    request,
  });

  return NextResponse.json({ message: "API key revoked" });
}
