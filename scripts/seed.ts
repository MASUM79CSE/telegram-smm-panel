/**
 * Seed script — creates the initial admin account and initializes platform
 * settings on first run.
 *
 * This intentionally does NOT create any example/demo catalog data
 * (ServiceGroup/Category/Service). Real catalog data must be created by an
 * admin from the admin panel (`/admin/services`, `/admin/service-groups`,
 * `/admin/categories`) once a real upstream `Provider` (or a deliberate
 * MANUAL-fulfillment offering) is configured — this keeps the storefront
 * from silently shipping placeholder services that look real to customers
 * but aren't backed by any actual fulfillment path.
 *
 * (A prior version of this script also created 4 example "(Demo)" services
 * — Telegram/Instagram/TikTok/YouTube — with no provider attached. That
 * behavior was removed; any such records created by an earlier run of this
 * script remain in the database until an admin edits or deletes them from
 * the admin panel, they are not touched by this script.)
 *
 * Idempotent: guarded by a `findUnique` check, safe to run repeatedly (e.g.
 * on every deploy) without creating a duplicate admin account.
 *
 * Usage: npm run seed
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { hash } from "bcryptjs";
import { prisma } from "../lib/db";
import { getSettings } from "../lib/services/settings";
import { toDecimal128 } from "../lib/money";

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@example.com").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";

  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    const passwordHash = await hash(adminPassword, 12);
    admin = await prisma.user.create({
      data: {
        name: "Administrator",
        email: adminEmail,
        passwordHash,
        role: "ADMIN",
        status: "ACTIVE",
        emailVerified: new Date(),
      },
    });
    await prisma.wallet.create({ data: { userId: admin.id, balance: toDecimal128("0") } });
    console.log(`✅ Created admin account: ${adminEmail} / ${adminPassword}`);
    console.log(`⚠️  CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN.`);
  } else {
    console.log(`Admin account already exists: ${adminEmail}`);
  }

  await getSettings();
  console.log("Settings initialized.");

  console.log(
    "\nNo example catalog data was created. Add real services from the admin panel " +
      "(Service Groups → Categories → Services) once a provider is configured.\n" +
      "\nSeed complete."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
