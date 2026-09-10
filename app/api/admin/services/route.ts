import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Service } from "@/models/Service";
import { Category } from "@/models/Category";
import { Provider } from "@/models/Provider";
import { serviceSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

// Ensure related models are registered before using populate() on them.
void Category;
void Provider;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();
  const services = await Service.find().populate("categoryId", "name").populate("providerId", "name type").sort({ createdAt: -1 }).lean();
  return NextResponse.json({ services });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const body = await request.json();
  const parsed = serviceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const service = await Service.create(parsed.data);

  await recordAudit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "SERVICE_CREATED",
    targetType: "Service",
    targetId: service._id.toString(),
    request,
  });

  return NextResponse.json({ message: "Service created", service }, { status: 201 });
}
