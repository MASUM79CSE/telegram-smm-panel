import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { favoriteServiceSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";
import { requestLogger } from "@/lib/logger";

/**
 * Saved/favorite services (docs/DASHBOARD_UPGRADE_PLAN.md §3.6) — toggle
 * endpoint. `POST` adds, `DELETE` removes (both idempotent: adding an
 * already-favorited service or removing a not-favorited one is a no-op,
 * not an error, since the client-side star toggle doesn't need to track
 * which direction it's about to flip before calling this).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const favorites = await prisma.favoriteService.findMany({
    where: { userId: session.user.id },
    select: { serviceId: true },
  });

  return NextResponse.json({
    favoriteServiceIds: favorites.map((f) => f.serviceId),
  });
}

export async function POST(request: Request) {
  const log = requestLogger(request);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = favoriteServiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Idempotent add: upsert on the composite PK, no-op if already favorited.
    await prisma.favoriteService.upsert({
      where: { userId_serviceId: { userId: session.user.id, serviceId: parsed.data.serviceId } },
      update: {},
      create: { userId: session.user.id, serviceId: parsed.data.serviceId },
    });

    await recordAudit({
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "FAVORITE_SERVICE_ADDED",
      targetType: "Service",
      targetId: parsed.data.serviceId,
      request,
    });

    return NextResponse.json({ message: "Added to favorites" });
  } catch (error) {
    log.error({ err: error }, "Add favorite error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const log = requestLogger(request);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = favoriteServiceSchema.safeParse({ serviceId: searchParams.get("serviceId") });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Idempotent remove: no-op if the favorite doesn't exist.
    await prisma.favoriteService.deleteMany({
      where: { userId: session.user.id, serviceId: parsed.data.serviceId },
    });

    await recordAudit({
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "FAVORITE_SERVICE_REMOVED",
      targetType: "Service",
      targetId: parsed.data.serviceId,
      request,
    });

    return NextResponse.json({ message: "Removed from favorites" });
  } catch (error) {
    log.error({ err: error }, "Remove favorite error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
