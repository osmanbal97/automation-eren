import { type Database, getDb } from "@/db/client";
import { errorLogs } from "@/db/schema";

export interface ErrorLogEntry {
  provider: string;
  operation: string;
  payloadSummary?: string;
  errorMessage: string;
  attemptCount: number;
}

/** Storage abstraction so unit tests can assert on logged errors without a real database. */
export interface ErrorLogStore {
  log(entry: ErrorLogEntry): Promise<void>;
}

export function createDrizzleErrorLogStore(db: Database = getDb()): ErrorLogStore {
  return {
    async log(entry) {
      await db.insert(errorLogs).values({
        provider: entry.provider,
        operation: entry.operation,
        payloadSummary: entry.payloadSummary ?? null,
        errorMessage: entry.errorMessage,
        attemptCount: entry.attemptCount,
      });
    },
  };
}
