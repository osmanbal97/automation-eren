import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { ideas } from "@/db/schema";
import type { ClaudeClient } from "@/lib/claude-client";
import { ActionNotFoundError } from "./errors";
import { optimizeIdeaPrompt } from "./prompt-optimizer";
import { seedIdea, seedNiche } from "./test-helpers";

function fakeClaudeClient(text: string, status = 200): ClaudeClient {
  return { complete: vi.fn().mockResolvedValue({ status, text }) };
}

describe("optimizeIdeaPrompt", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("throws ActionNotFoundError for an unknown idea", async () => {
    const client = fakeClaudeClient("a rewritten prompt");
    await expect(
      optimizeIdeaPrompt(db, "00000000-0000-0000-0000-000000000000", client, undefined, "web"),
    ).rejects.toThrow(ActionNotFoundError);
  });

  it("rewrites the prompt via Claude and persists it through editIdeaPrompt, recording the channel", async () => {
    const niche = await seedNiche(db, { themeGuidance: "hyper-saturated psychedelic POV rides" });
    const idea = await seedIdea(db, niche.id, { prompt: "a bike ride" });
    const client = fakeClaudeClient("first-person pov, neon bicycle ride through a folding kaleidoscope tunnel");

    const updated = await optimizeIdeaPrompt(db, idea.id, client, undefined, "telegram");

    expect(updated.prompt).toBe("first-person pov, neon bicycle ride through a folding kaleidoscope tunnel");
    expect(updated.updatedVia).toBe("telegram");
    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(client.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.any(String),
        prompt: expect.stringContaining(niche.themeGuidance),
      }),
    );

    const [row] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    expect(row.prompt).toBe("first-person pov, neon bicycle ride through a folding kaleidoscope tunnel");
  });

  it("folds an operator note into the prompt sent to Claude", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);
    const client = fakeClaudeClient("a better prompt");

    await optimizeIdeaPrompt(db, idea.id, client, "make it slower and dreamier", "web");

    expect(client.complete).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining("make it slower and dreamier") }),
    );
  });

  it("throws when Claude returns a non-200 status", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);
    const client = fakeClaudeClient("", 500);

    await expect(optimizeIdeaPrompt(db, idea.id, client, undefined, "web", { maxAttempts: 1 })).rejects.toThrow();
  });

  it("throws when Claude returns an empty rewrite", async () => {
    const niche = await seedNiche(db);
    const idea = await seedIdea(db, niche.id);
    const client = fakeClaudeClient("   ");

    await expect(optimizeIdeaPrompt(db, idea.id, client, undefined, "web")).rejects.toThrow(/empty/);
  });
});
