/**
 * One-time backfill: for every existing `Service` with a non-null
 * `providerId` (the legacy single-provider fields), create a corresponding
 * `ServiceProvider` row (`priority: 0`) so `lib/fulfillment.ts`'s new
 * multi-provider dispatch logic has something to read.
 *
 * Idempotent: skips any service that already has a `ServiceProvider` row
 * for its legacy `providerId` — safe to run multiple times, same
 * discipline already used elsewhere in this codebase (e.g. deposit
 * approval's `idempotencyKey` pattern, `scripts/seed.ts`'s
 * `findUnique`-guard convention), applied here to a one-time data
 * migration instead of a runtime action.
 *
 * `Service.providerId`/`providerServiceId`/`providerRate` are NOT removed
 * by this script — they stay as a deprecated-but-kept fallback (see
 * docs/DATABASE.md §2) for any service that still hasn't been backfilled,
 * consistent with this project's additive-migration philosophy.
 *
 * Usage: npm run backfill-service-providers
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { prisma } from "../lib/db";
import { recordAudit } from "../lib/audit";

async function main() {
  const services = await prisma.service.findMany({ where: { providerId: { not: null } } });
  console.log(`Found ${services.length} service(s) with a legacy single-provider link.`);

  let created = 0;
  let skipped = 0;

  for (const service of services) {
    if (!service.providerId) continue; // narrows the type; query already filtered this

    const existing = await prisma.serviceProvider.findFirst({
      where: { serviceId: service.id, providerId: service.providerId },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.serviceProvider.create({
      data: {
        serviceId: service.id,
        providerId: service.providerId,
        providerServiceId: service.providerServiceId ?? "",
        providerRate: service.providerRate ?? service.rate,
        priority: 0,
        active: true,
      },
    });
    created += 1;
    console.log(`✅ Backfilled ServiceProvider link for service: ${service.name}`);
  }

  await recordAudit({
    actorId: null, // system/automated action, not an admin session
    actorEmail: null,
    action: "SERVICE_PROVIDER_BACKFILL_RUN",
    targetType: "ServiceProvider",
    targetId: undefined,
    metadata: { created, skipped, totalCandidates: services.length },
  });

  console.log(`\nBackfill complete: ${created} created, ${skipped} already existed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
