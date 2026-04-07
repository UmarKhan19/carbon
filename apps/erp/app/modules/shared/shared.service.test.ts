import { describe, expect, it, vi } from "vitest";

// @carbon/auth eagerly reads env vars at module load. The import chain
// shared.service.ts → ~/utils/query → @carbon/auth triggers that even
// though we're only testing pure pricing helpers. Stub the module to
// short-circuit the env-var checks.
vi.mock("@carbon/auth", () => ({
  badRequest: (message: string) => ({ error: message }),
  parseNumberFromUrlParam: (param: string | null, defaultValue: number) =>
    param ? Number(param) : defaultValue
}));

const { lookupPriceFromBreaks, resolveSupplierPrice } = await import(
  "./shared.service"
);

describe("lookupPriceFromBreaks", () => {
  it("returns fallback when priceBreaks is empty", () => {
    expect(lookupPriceFromBreaks([], 10, 99)).toBe(99);
  });

  it("returns fallback when requested qty is below the lowest tier", () => {
    const breaks = [
      { quantity: 10, unitPrice: 90 },
      { quantity: 100, unitPrice: 80 }
    ];
    expect(lookupPriceFromBreaks(breaks, 5, 100)).toBe(100);
  });

  it("returns the tier price when qty exactly matches a tier", () => {
    const breaks = [
      { quantity: 1, unitPrice: 100 },
      { quantity: 10, unitPrice: 90 }
    ];
    expect(lookupPriceFromBreaks(breaks, 10, 999)).toBe(90);
  });

  it("picks the highest applicable tier between tiers", () => {
    const breaks = [
      { quantity: 1, unitPrice: 100 },
      { quantity: 10, unitPrice: 90 },
      { quantity: 100, unitPrice: 80 }
    ];
    expect(lookupPriceFromBreaks(breaks, 50, 999)).toBe(90);
  });

  it("returns the top tier when qty exceeds the highest break", () => {
    const breaks = [
      { quantity: 1, unitPrice: 100 },
      { quantity: 10, unitPrice: 90 },
      { quantity: 100, unitPrice: 80 }
    ];
    expect(lookupPriceFromBreaks(breaks, 500, 999)).toBe(80);
  });

  it("handles unsorted break input correctly", () => {
    const breaks = [
      { quantity: 100, unitPrice: 80 },
      { quantity: 1, unitPrice: 100 },
      { quantity: 10, unitPrice: 90 }
    ];
    expect(lookupPriceFromBreaks(breaks, 50, 999)).toBe(90);
    expect(lookupPriceFromBreaks(breaks, 200, 999)).toBe(80);
  });

  it("handles decimal quantities at tier boundaries", () => {
    const breaks = [
      { quantity: 1, unitPrice: 100 },
      { quantity: 10.5, unitPrice: 90 }
    ];
    expect(lookupPriceFromBreaks(breaks, 10.5, 999)).toBe(90);
    expect(lookupPriceFromBreaks(breaks, 10.4, 999)).toBe(100);
  });
});

describe("resolveSupplierPrice", () => {
  it("returns fallback when priceBreaks is empty (regardless of rate)", () => {
    expect(resolveSupplierPrice([], 10, 50, 2)).toBe(50);
    expect(resolveSupplierPrice([], 10, 50, 1)).toBe(50);
  });

  it("converts a matching tier's price by dividing by the exchange rate", () => {
    const breaks = [{ quantity: 10, unitPrice: 20 }];
    expect(resolveSupplierPrice(breaks, 10, 5, 2)).toBe(10);
  });

  it("applies fallback correctly when qty is below all tiers", () => {
    const breaks = [{ quantity: 10, unitPrice: 20 }];
    expect(resolveSupplierPrice(breaks, 1, 5, 2)).toBe(5);
  });

  it("treats exchangeRate = 1 as passthrough", () => {
    const breaks = [
      { quantity: 1, unitPrice: 100 },
      { quantity: 10, unitPrice: 90 }
    ];
    expect(resolveSupplierPrice(breaks, 10, 999, 1)).toBe(90);
    expect(resolveSupplierPrice(breaks, 5, 999, 1)).toBe(100);
  });

  it("picks the correct tier and converts for qty above top break", () => {
    const breaks = [
      { quantity: 1, unitPrice: 100 },
      { quantity: 10, unitPrice: 80 }
    ];
    expect(resolveSupplierPrice(breaks, 50, 999, 2)).toBe(40);
  });
});
