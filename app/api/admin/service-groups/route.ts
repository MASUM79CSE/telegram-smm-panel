import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { ServiceGroup } from "@/models/ServiceGroup";
import { serviceGroupSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const groups = await ServiceGroup.find().sort({ sortOrder: 1, name: 1 }).lean();
  return NextResponse.json({ groups });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const body = await request.json();
  const parsed = serviceGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const slug = slugify(parsed.data.name);

  const existing = await ServiceGroup.findOne({ $or: [{ name: parsed.data.name }, { slug }] });
  if (existing) {
    return NextResponse.json({ error: "A service group with this name already exists." }, { status: 409 });
  }

  const group = await ServiceGroup.create({ ...parsed.data, slug });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_GROUP_CREATED",
    targetType: "ServiceGroup",
    targetId: group._id.toString(),
    request,
  });

  return NextResponse.json({ message: "Service group created", group }, { status: 201 });
}
