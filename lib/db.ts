import mongoose from "mongoose";
import { env } from "@/lib/env";
// Import the model registry so every Mongoose model is registered on the
// default connection regardless of which module first calls connectDB().
// This prevents "Schema hasn't been registered for model X" errors when a
// route only imports the model it queries directly but populates a ref to
// another model it never imported.
import "@/models";

/**
 * Cached Mongoose connection across hot-reloads (dev) and serverless
 * invocations (prod) to avoid exhausting MongoDB Atlas connection limits.
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var __mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global.__mongooseCache ?? { conn: null, promise: null };

if (!global.__mongooseCache) {
  global.__mongooseCache = cache;
}

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) {
    return cache.conn;
  }

  if (!cache.promise) {
    mongoose.set("strictQuery", true);

    cache.promise = mongoose
      .connect(env.MONGODB_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        family: 4,
        // Building an index synchronously on connect is safe (and useful)
        // in dev, but on a production collection with meaningful data
        // volume it can briefly hold a write lock and cause timeouts.
        // Production index changes should instead be applied explicitly
        // via `Model.syncIndexes()` during a deploy/maintenance window —
        // see docs/DATABASE.md §8 (Migration Strategy).
        autoIndex: env.NODE_ENV !== "production",
      })
      .then((m) => m);
  }

  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null;
    throw err;
  }

  return cache.conn;
}

export default connectDB;
