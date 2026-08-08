import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "./schema";

/**
 * Spins up a fresh, fully-migrated in-memory Postgres database (via pglite -
 * a WASM Postgres build) for tests. No Docker / external Postgres required.
 * Each call returns an isolated database, so tests don't leak state into
 * one another.
 */
export async function createTestDb(): Promise<PgliteDatabase<typeof schema>> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}
