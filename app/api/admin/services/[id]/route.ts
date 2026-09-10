import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Service } from "@/models/Service";
import { serviceBaseSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const { id } = await params;

  const body = await request.json();
  const parsed = serviceBaseSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  // `serviceBaseSchema` (unlike `serviceSchema`) has no `.refine()` for
  // maxQuantity >= minQuantity — `.partial()` cannot be combined with
  // `.refine()` in Zod (see that schema's doc comment) and a PATCH must be
  // able to touch a single field without requiring the other. So this
  // cross-field invariant is re-checked manually here, but ONLY when the
  // request actually supplies both fields (an edit that only touches one of
  // the two, e.g. just raising maxQuantity, is validated against the
  // service's EXISTING value for the other — fetched below — rather than
  // silently skipped).
  const existingForValidation =
    parsed.data.minQuantity !== undefined || parsed.data.maxQuantity !== undefined
      ? await Service.findById(id).select("minQuantity maxQuantity")
      : null;

  const effectiveMin = parsed.data.minQuantity ?? existingForValidation?.minQuantity;
  const effectiveMax = parsed.data.maxQuantity ?? existingForValidation?.maxQuantity;

  if (
    effectiveMin !== undefined &&
    effectiveMax !== undefined &&
    effectiveMin !== null &&
    effectiveMax !== null &&
    effectiveMax < effectiveMin
  ) {
    return NextResponse.json(
      { error: "Invalid data", details: { maxQuantity: ["maxQuantity must be >= minQuantity"] } },
      { status: 400 }
    );
  }

  const service = await Service.findByIdAndUpdate(id, parsed.data, { returnDocument: "after" });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_UPDATED",
    targetType: "Service",
    targetId: id,
    request,
  });

  return NextResponse.json({ message: "Service updated", service });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const { id } = await params;

  // Soft-delete pattern: deactivate rather than hard-delete, since existing
  // orders reference this service and must remain viewable/consistent.
  const service = await Service.findByIdAndUpdate(id, { active: false, hidden: true }, { returnDocument: "after" });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_DELETED",
    targetType: "Service",
    targetId: id,
    request,
  });

  return NextResponse.json({ message: "Service deactivated" });
}
