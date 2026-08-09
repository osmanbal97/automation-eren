import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createTestDb } from "@/db/test-db";
import { ideas } from "@/db/schema";
import type { ClaudeClient } from "@/lib/claude-client";
import { ActionNotFoundError } from "./errors";
import { generateIdeas } from "./generate-ideas";
import { seedNiche, seedProvider } from "./test-helpers";

function fakeClaudeClient(text: string, status = 200): ClaudeClient {
  return { complete: vi.fn().mockResolvedValue({ status, text }) };
}

const SAMPLE_IDEAS = [
  {
    title: "Infinite tunnel bike ride",
    concept: "POV riding a bike into an infinite colorful tunnel",
    prompt: "first-person pov, riding a bicycle into an infinite trippy tunnel, vibrant colors",
    caption: "into the void \u{1F308}",
    hashtags: ["trippy", "pov"],
  },
  {
    title: "Melting city skyline",
    concept: "POV walking through a city as buildings melt like wax",
    prompt: "first-person pov, walking through a city street, buildings melting like candle wax",
    caption: "reality is optional \u{1F300}",
    hashtags: ["surreal", "aiart"],
  },
];

describe("generateIdeas", () => {
  let db: Database;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database;
  });

  it("throws ActionNotFoundError for an unknown niche", async () => {
    const client = fakeClaudeClient(JSON.stringify(SAMPLE_IDEAS));
    await expect(generateIdeas(db, "00000000-0000-0000-0000-000000000000", client)).rejects.toThrow(
      ActionNotFoundError,
    );
  });

  it("parses Claude's response and saves each idea as pending_review, inheriting the niche's default provider + specs", async () => {
    const provider = await seedProvider(db, { pricingModel: "per_second", unitPrice: "0.20" });
    const niche = await seedNiche(db, {
      defaultProviderId: provider.id,
      defaultGenerationSpecs: { resolution: "1080x1920", durationSeconds: 8, aspectRatio: "9:16" },
    });
    const client = fakeClaudeClient(JSON.stringify(SAMPLE_IDEAS));

    const created = await generateIdeas(db, niche.id, client, 2);

    expect(created).toHaveLength(2);
    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(client.complete).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.any(String), prompt: expect.stringContaining(niche.themeGuidance) }),
    );

    for (const [i, row] of created.entries()) {
      expect(row.title).toBe(SAMPLE_IDEAS[i].title);
      expect(row.concept).toBe(SAMPLE_IDEAS[i].concept);
      expect(row.prompt).toBe(SAMPLE_IDEAS[i].prompt);
      expect(row.caption).toBe(SAMPLE_IDEAS[i].caption);
      expect(row.hashtags).toEqual(SAMPLE_IDEAS[i].hashtags);
      expect(row.status).toBe("pending_review");
      expect(row.providerId).toBe(provider.id);
      expect(row.generationSpecs).toEqual({ resolution: "1080x1920", durationSeconds: 8, aspectRatio: "9:16" });
      // per_second pricing, $0.20/s * 8s = $1.60
      expect(row.estimatedCost).toBe("1.6000");
    }

    const all = await db.select().from(ideas);
    expect(all).toHaveLength(2);
  });

  it("includes a distinct reference-guidance section in the prompt when the niche has one (US-027)", async () => {
    const niche = await seedNiche(db, {
      referenceGuidance: "slow-motion rain on a window, teal-and-amber grade",
    });
    const client = fakeClaudeClient(JSON.stringify(SAMPLE_IDEAS));

    await generateIdeas(db, niche.id, client, 2);

    expect(client.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("slow-motion rain on a window, teal-and-amber grade"),
      }),
    );
    const { prompt } = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prompt).toContain("Reference video style guidance");
    // Distinct from theme guidance, not concatenated into it.
    expect(prompt.indexOf(niche.themeGuidance)).toBeLessThan(
      prompt.indexOf("Reference video style guidance"),
    );
  });

  it("prompt is unchanged when referenceGuidance is null (regression pin for US-027)", async () => {
    const niche = await seedNiche(db, { referenceGuidance: null });
    const client = fakeClaudeClient(JSON.stringify(SAMPLE_IDEAS));

    await generateIdeas(db, niche.id, client, 2);

    const { prompt } = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prompt).not.toContain("Reference video style guidance");
    expect(prompt).toBe(
      `Generate exactly 2 distinct short-form video ideas for this niche:\n\n` +
        `${niche.themeGuidance}\n\n` +
        "Respond with only the JSON array.",
    );
  });

  it("saves ideas with no estimated cost when the niche has no default provider", async () => {
    const niche = await seedNiche(db, { defaultProviderId: null });
    const client = fakeClaudeClient(JSON.stringify(SAMPLE_IDEAS));

    const created = await generateIdeas(db, niche.id, client, 2);

    for (const row of created) {
      expect(row.providerId).toBeNull();
      expect(row.estimatedCost).toBeNull();
    }
  });

  it("throws when Claude's response isn't valid JSON", async () => {
    const niche = await seedNiche(db);
    const client = fakeClaudeClient("not json");

    await expect(generateIdeas(db, niche.id, client)).rejects.toThrow(/not valid JSON/);
  });

  it("throws when Claude's response doesn't match the expected shape", async () => {
    const niche = await seedNiche(db);
    const client = fakeClaudeClient(JSON.stringify([{ title: "only a title" }]));

    await expect(generateIdeas(db, niche.id, client)).rejects.toThrow();
  });

  it("throws when Claude returns a non-200 status", async () => {
    const niche = await seedNiche(db);
    const client = fakeClaudeClient("", 500);

    await expect(generateIdeas(db, niche.id, client, 5, { maxAttempts: 1 })).rejects.toThrow();
  });
});
