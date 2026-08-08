import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { ActionNotFoundError, InvalidActionStateError } from "./errors";
import { approveIdea, editIdeaCaption, editIdeaPrompt, rejectIdea, setIdeaProvider } from "./ideas";
import { seedIdea, seedNiche, seedProvider } from "./test-helpers";

describe("idea actions", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("approveIdea moves a pending idea to approved and records the channel", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);

    const updated = await approveIdea(db, idea.id, "telegram");

    expect(updated.status).toBe("approved");
    expect(updated.approvedVia).toBe("telegram");
  });

  it("approveIdea rejects a non-pending idea with a typed error", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id, { status: "approved" });

    await expect(approveIdea(db, idea.id, "web")).rejects.toThrow(InvalidActionStateError);
  });

  it("approveIdea throws ActionNotFoundError for an unknown id", async () => {
    await expect(approveIdea(db, "00000000-0000-0000-0000-000000000000", "web")).rejects.toThrow(
      ActionNotFoundError,
    );
  });

  it("rejectIdea marks an idea rejected via the triggering channel", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);

    const updated = await rejectIdea(db, idea.id, "web");

    expect(updated.status).toBe("rejected");
    expect(updated.updatedVia).toBe("web");
  });

  it("editIdeaPrompt updates the prompt and records the channel", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);

    const updated = await editIdeaPrompt(db, idea.id, "new prompt text", "telegram");

    expect(updated.prompt).toBe("new prompt text");
    expect(updated.updatedVia).toBe("telegram");
  });

  it("editIdeaCaption updates the caption and records the channel", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);

    const updated = await editIdeaCaption(db, idea.id, "new caption", "web");

    expect(updated.caption).toBe("new caption");
    expect(updated.updatedVia).toBe("web");
  });

  it("setIdeaProvider overrides the provider and records the channel", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);
    const provider = await seedProvider(db);

    const updated = await setIdeaProvider(db, idea.id, provider.id, "telegram");

    expect(updated.providerId).toBe(provider.id);
    expect(updated.updatedVia).toBe("telegram");
  });
});
