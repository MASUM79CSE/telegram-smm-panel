import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/services/settings";
import { settingsSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const settings = await prisma.settings.upsert({
    where: { key: "global" },
    create: { key: "global", ...parsed.data },
    update: parsed.data,
  });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SETTINGS_UPDATED",
    targetType: "Settings",
    metadata: parsed.data,
    request,
  });

  return NextResponse.json({ message: "Settings updated", settings });
}
