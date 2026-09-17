import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { categorySchema } from "@/lib/validation";
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

  const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return NextResponse.json({ categories });
}

/** Normalizes an optional groupId: empty string / undefined -> null, and confirms the referenced group actually exists so a typo/stale id doesn't silently produce an orphaned reference. */
async function resolveGroupId(groupId: string | null | undefined): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  if (!groupId) return { ok: true, value: null };
  const exists = await prisma.serviceGroup.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!exists) return { ok: false, error: "Service group not found" };
  return { ok: true, value: groupId };
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = categorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const slug = slugify(parsed.data.name);

  const existing = await prisma.category.findFirst({ where: { OR: [{ name: parsed.data.name }, { slug }] } });
  if (existing) {
    return NextResponse.json({ error: "A category with this name already exists." }, { status: 409 });
  }

  const groupResult = await resolveGroupId(parsed.data.groupId);
  if (!groupResult.ok) {
    return NextResponse.json({ error: groupResult.error }, { status: 400 });
  }

  const category = await prisma.category.create({ data: { ...parsed.data, groupId: groupResult.value, slug } });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "CATEGORY_CREATED",
    targetType: "Category",
    targetId: category.id,
    request,
  });

  return NextResponse.json({ message: "Category created", category }, { status: 201 });
}
