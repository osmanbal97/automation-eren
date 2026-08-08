import type { GenerationSpecs } from "./video-providers/types";

export type PricingModel = "per_second" | "per_generation" | "per_credit";

export interface CostEstimatorProvider {
  pricingModel: PricingModel;
  /** Numeric or the numeric-as-string shape Drizzle returns for `numeric` columns. */
  unitPrice: string | number;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Approximate cost for one generation, shown to the operator before any paid
 * call is made (web idea review, Telegram idea card, etc). Rounded to 4
 * decimal places to match the estimated_cost/actual_cost/unit_price columns
 * (numeric(10,4)).
 */
export function estimateCost(provider: CostEstimatorProvider, specs: GenerationSpecs): number {
  const unitPrice = typeof provider.unitPrice === "string" ? Number(provider.unitPrice) : provider.unitPrice;

  switch (provider.pricingModel) {
    case "per_second":
      return round4(unitPrice * specs.durationSeconds);
    case "per_generation":
      return round4(unitPrice);
    case "per_credit":
      return round4(unitPrice * (specs.credits ?? 1));
    default: {
      const exhaustiveCheck: never = provider.pricingModel;
      throw new Error(`Unknown pricing model: ${exhaustiveCheck}`);
    }
  }
}
