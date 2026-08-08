import { describe, expect, it } from "vitest";
import { estimateCost } from "./cost-estimator";

describe("estimateCost", () => {
  it("per_second: multiplies unit price by duration", () => {
    const cost = estimateCost(
      { pricingModel: "per_second", unitPrice: "0.2000" },
      { resolution: "1080x1920", durationSeconds: 8 },
    );
    expect(cost).toBeCloseTo(1.6, 4);
  });

  it("per_generation: flat unit price regardless of specs", () => {
    const cost = estimateCost(
      { pricingModel: "per_generation", unitPrice: "1.5000" },
      { resolution: "1080x1920", durationSeconds: 6 },
    );
    expect(cost).toBe(1.5);
  });

  it("per_credit: multiplies unit price by credits when provided", () => {
    const cost = estimateCost(
      { pricingModel: "per_credit", unitPrice: "0.0500" },
      { resolution: "1080x1920", durationSeconds: 10, credits: 20 },
    );
    expect(cost).toBeCloseTo(1.0, 4);
  });

  it("per_credit: defaults to 1 credit when not specified", () => {
    const cost = estimateCost(
      { pricingModel: "per_credit", unitPrice: "0.0500" },
      { resolution: "1080x1920", durationSeconds: 10 },
    );
    expect(cost).toBe(0.05);
  });

  it("accepts a numeric unitPrice as well as the numeric-as-string DB shape", () => {
    const cost = estimateCost(
      { pricingModel: "per_second", unitPrice: 0.2 },
      { resolution: "1080x1920", durationSeconds: 3 },
    );
    expect(cost).toBeCloseTo(0.6, 4);
  });

  it("rounds to 4 decimal places", () => {
    const cost = estimateCost(
      { pricingModel: "per_second", unitPrice: "0.1234" },
      { resolution: "1080x1920", durationSeconds: 3 },
    );
    expect(cost).toBe(0.3702);
  });
});
