import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Category } from "@/models/Category";
import { ServiceGroup } from "@/models/ServiceGroup";
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

  await connectDB();
  const categories = await Category.find().sort({ sortOrder: 1, name: 1 }).lean();
  return NextResponse.json({ categories });
}

/** Normalizes an optional groupId: empty string / undefined -> null, and confirms the referenced group actually exists so a typo/stale id doesn't silently produce an orphaned reference. */
async function resolveGroupId(groupId: string | null | undefined): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  if (!groupId) return { ok: true, value: null };
  const exists = await ServiceGroup.exists({ _id: groupId });
  if (!exists) return { ok: false, error: "Service group not found" };
  return { ok: true, value: groupId };
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const body = await request.json();
  const parsed = categorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const slug = slugify(parsed.data.name);

  const existing = await Category.findOne({ $or: [{ name: parsed.data.name }, { slug }] });
  if (existing) {
    return NextResponse.json({ error: "A category with this name already exists." }, { status: 409 });
  }

  const groupResult = await resolveGroupId(parsed.data.groupId);
  if (!groupResult.ok) {
    return NextResponse.json({ error: groupResult.error }, { status: 400 });
  }

  const category = await Category.create({ ...parsed.data, groupId: groupResult.value, slug });

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "CATEGORY_CREATED",
    targetType: "Category",
    targetId: category._id.toString(),
    request,
  });

  return NextResponse.json({ message: "Category created", category }, { status: 201 });
}
