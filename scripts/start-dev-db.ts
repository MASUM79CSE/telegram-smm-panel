/**
 * Starts an ephemeral local MongoDB instance (via mongodb-memory-server) for
 * local development/testing ONLY — this is not used in production. In
 * production, set MONGODB_URI to your MongoDB Atlas connection string.
 *
 * Prints the connection URI to stdout and keeps running until killed.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";

async function main() {
  // Replica set (not standalone) because our order/payment logic uses
  // multi-document transactions, which require a replica set — exactly like
  // MongoDB Atlas (even the free M0 tier is always a replica set).
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  const uri = replSet.getUri();
  console.log("MONGODB_URI=" + uri);
  console.log("Local dev MongoDB replica set is running. Press Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    await replSet.stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await replSet.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
