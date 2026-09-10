import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { accountUpdateSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";
import { requestLogger } from "@/lib/logger";

/**
 * Self-service account profile update (docs/DASHBOARD_UPGRADE_PLAN.md §3.3).
 * Deliberately narrow — only `name` is editable here. Email changes are not
 * supported (would need re-verification flow, an intentionally separate,
 * larger scope decision) and password changes go through the dedicated
 * `/api/account/change-password` route so its own current-password check
 * and audit action stay distinct from a plain profile edit.
 */
export async function PATCH(request: Request) {
  const log = requestLogger(request);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = accountUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    await connectDB();

    const user = await User.findByIdAndUpdate(
      session.user.id,
      { name: parsed.data.name },
      { returnDocument: "after" }
    ).select("name email");

    if (!user) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    await recordAudit({
      actorId: session.user.id,
      actorEmail: session.user.email,
      action: "ACCOUNT_UPDATED",
      targetType: "User",
      targetId: session.user.id,
      request,
    });

    return NextResponse.json({ user: { name: user.name, email: user.email } });
  } catch (error) {
    log.error({ err: error }, "Account update error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
