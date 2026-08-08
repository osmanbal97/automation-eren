import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let cachedClient: ReturnType<typeof postgres> | undefined;
let cachedDb: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Lazily-created singleton Drizzle client. Lazy so that importing this module
 * (e.g. from code that only needs the `schema` export) never throws when
 * DATABASE_URL isn't set, and so that a single connection pool is reused
 * across warm Fluid Compute invocations instead of reconnecting per request.
 */
export function getDb() {
  if (!cachedDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set.");
    }
    cachedClient = postgres(connectionString, { prepare: false });
    cachedDb = drizzle(cachedClient, { schema });
  }
  return cachedDb;
}

export type Database = ReturnType<typeof getDb>;
