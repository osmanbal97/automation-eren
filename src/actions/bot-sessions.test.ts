import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { clearPendingSession, getPendingSession, setPendingSession } from "./bot-sessions";

describe("bot session actions", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("returns null for a chat with no session row yet", async () => {
    expect(await getPendingSession(db, "no-such-chat")).toBeNull();
  });

  it("setPendingSession creates a row and getPendingSession reads it back", async () => {
    await setPendingSession(db, "chat-1", {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: "00000000-0000-0000-0000-000000000001",
      pendingField: "prompt",
    });

    const session = await getPendingSession(db, "chat-1");
    expect(session).toEqual({
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: "00000000-0000-0000-0000-000000000001",
      pendingField: "prompt",
    });
  });

  it("setPendingSession upserts rather than duplicating a row for the same chat", async () => {
    await setPendingSession(db, "chat-1", {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: "00000000-0000-0000-0000-000000000001",
      pendingField: "prompt",
    });
    await setPendingSession(db, "chat-1", {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: "00000000-0000-0000-0000-000000000002",
      pendingField: "caption",
    });

    const session = await getPendingSession(db, "chat-1");
    expect(session?.pendingEntityId).toBe("00000000-0000-0000-0000-000000000002");
    expect(session?.pendingField).toBe("caption");
  });

  it("getPendingSession treats a row with a null pendingAction as no pending session", async () => {
    await setPendingSession(db, "chat-2", {
      pendingAction: null,
      pendingEntityType: null,
      pendingEntityId: null,
      pendingField: null,
    });

    expect(await getPendingSession(db, "chat-2")).toBeNull();
  });

  it("clearPendingSession nulls out the pending fields without erroring on a fresh chat", async () => {
    await setPendingSession(db, "chat-3", {
      pendingAction: "awaiting_text",
      pendingEntityType: "idea",
      pendingEntityId: "00000000-0000-0000-0000-000000000003",
      pendingField: "prompt",
    });

    await clearPendingSession(db, "chat-3");

    expect(await getPendingSession(db, "chat-3")).toBeNull();
  });
});
