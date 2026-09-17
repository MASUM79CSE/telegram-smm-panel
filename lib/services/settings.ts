import { prisma } from "@/lib/db";

/**
 * Get-or-create the single global Settings row.
 *
 * Postgres/Prisma migration note: this replaces the original
 * `models/Settings.ts#getSettings()` helper (a Mongoose model can export
 * arbitrary static functions alongside its schema; a Prisma model is just
 * a data shape, so this kind of "domain" helper now lives in
 * `lib/services/` like every other business-logic function in this
 * codebase — arguably a better fit for it anyway). `upsert` on the fixed
 * `key: "global"` id is a single atomic round-trip replacing the original
 * `findOne` then conditional `create` pair.
 */
export async function getSettings() {
  return prisma.settings.upsert({
    where: { key: "global" },
    create: { key: "global" },
    update: {},
  });
}
