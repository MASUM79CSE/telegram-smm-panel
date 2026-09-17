/**
 * Local development database helper (Postgres/Supabase edition).
 *
 * Unlike the original MongoDB version of this script — which could spin up
 * a fully disposable, ephemeral `mongodb-memory-server` replica set with no
 * pre-existing installation required — there is no equivalent bundled
 * in-memory/embedded Postgres server for Node (nothing here is a drop-in
 * replacement for a real `pg_ctl`-managed instance, and `pg-mem` does not
 * support enough of real Postgres's transaction/constraint semantics to
 * trust for this project's money-moving logic). So this script does NOT
 * start an ephemeral database; instead it checks whether a local Postgres
 * server is reachable at the connection string you already have configured
 * (`DATABASE_URL` in `.env`/`.env.local`) and prints copy-pasteable setup
 * commands if not.
 *
 * For actual local development, the recommended options (in order of
 * simplicity) are:
 *   1. Point `DATABASE_URL`/`DIRECT_URL` at a free Supabase project — no
 *      local install needed at all, and it matches production exactly.
 *   2. Install PostgreSQL locally (`sudo apt-get install postgresql`,
 *      `brew install postgresql`, etc.) and create a dev database.
 *   3. Run Postgres in Docker (`docker run -e POSTGRES_PASSWORD=postgres
 *      -p 5432:5432 postgres:16`), if Docker is available in your
 *      environment (it is NOT available in this project's own sandbox —
 *      see lib/__tests__/integration/setup.ts's header comment).
 *
 * Usage: npm run start-dev-db
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "../lib/generated/prisma";

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      "❌ DATABASE_URL is not set.\n\n" +
        "Add it to .env.local, e.g.:\n" +
        "  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/telegram_panel_dev?schema=public\n" +
        "  DIRECT_URL=postgresql://postgres:postgres@localhost:5432/telegram_panel_dev?schema=public\n\n" +
        "See this file's header comment for local-Postgres setup options."
    );
    process.exit(1);
  }

  const client = new PrismaClient({ datasourceUrl: url });
  try {
    await client.$queryRaw`SELECT 1`;
    console.log(`✓ Successfully connected to the database at DATABASE_URL.`);
    console.log(`  If tables are missing, run: npx prisma db push`);
  } catch (err) {
    console.error(`❌ Could not connect to DATABASE_URL:`, err);
    console.error(`\nSee this file's header comment for local-Postgres setup options.`);
    process.exit(1);
  } finally {
    await client.$disconnect();
  }
}

main();
