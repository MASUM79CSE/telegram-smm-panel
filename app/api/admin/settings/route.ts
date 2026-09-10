import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Settings, getSettings } from "@/models/Settings";
import { settingsSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const body = await request.json();
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const settings = await Settings.findOneAndUpdate({ key: "global" }, parsed.data, { new: true, upsert: true });

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
