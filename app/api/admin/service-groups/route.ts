import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
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

  const groups = await prisma.serviceGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return NextResponse.json({ groups });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = serviceGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const slug = slugify(parsed.data.name);

  const existing = await prisma.serviceGroup.findFirst({ where: { OR: [{ name: parsed.data.name }, { slug }] } });
  if (existing) {
    return NextResponse.json({ error: "A service group with this name already exists." }, { status: 409 });
  }

  const group = await prisma.serviceGroup.create({ data: { ...parsed.data, slug } });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_GROUP_CREATED",
    targetType: "ServiceGroup",
    targetId: group.id,
    request,
  });

  return NextResponse.json({ message: "Service group created", group }, { status: 201 });
}
