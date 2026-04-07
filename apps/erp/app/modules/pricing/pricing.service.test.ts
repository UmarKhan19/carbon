import { describe, expect, it, vi } from "vitest";
import type { MatchedRule } from "./pricing.service";

// pricing.service.ts pulls in @carbon/auth (via ~/utils/query) and
// ~/services/database.server, both of which read env vars at module
// load. Stub them so we can import the pure pricing helpers in
// isolation.
vi.mock("@carbon/auth", () => ({
  badRequest: (message: string) => ({ error: message }),
  parseNumberFromUrlParam: (param: string | null, defaultValue: number) =>
    param ? Number(param) : defaultValue
}));

vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => {
    throw new Error(
      "getDatabaseClient is not available in pure-function tests"
    );
  }
}));

const { applyPriceRules, specificityScore } = await import("./pricing.service");

// ============================================================
// specificityScore — assignment + match type → numeric score
// (lower = more specific = wins)
// ============================================================

describe("specificityScore", () => {
  it("direct + item match scores 0 (highest specificity)", () => {
    expect(specificityScore("direct", "item")).toBe(0);
  });

  it("direct + category match scores 1", () => {
    expect(specificityScore("direct", "category")).toBe(1);
  });

  it("type + item match scores 2", () => {
    expect(specificityScore("type", "item")).toBe(2);
  });

  it("type + category match scores 3", () => {
    expect(specificityScore("type", "category")).toBe(3);
  });

  it("global + item match scores 4", () => {
    expect(specificityScore("global", "item")).toBe(4);
  });

  it("global + category match scores 5 (lowest specificity)", () => {
    expect(specificityScore("global", "category")).toBe(5);
  });

  it("direct beats type beats global for the same matchType", () => {
    expect(specificityScore("direct", "item")).toBeLessThan(
      specificityScore("type", "item")
    );
    expect(specificityScore("type", "item")).toBeLessThan(
      specificityScore("global", "item")
    );
  });

  it("item beats category for the same assignmentType", () => {
    expect(specificityScore("direct", "item")).toBeLessThan(
      specificityScore("direct", "category")
    );
  });
});

// ============================================================
// applyPriceRules — discount/surcharge/Discounted handling
// ============================================================

function makeRule(partial: Partial<MatchedRule>): MatchedRule {
  return {
    id: "rule_1",
    name: "Rule",
    ruleType: "Discount",
    amountType: "Percentage",
    amount: 0,
    ...partial
  };
}

describe("applyPriceRules", () => {
  it("with no rules, finalPrice equals basePrice and trace is empty", () => {
    const { finalPrice, appendedTrace } = applyPriceRules(100, [], "Net");
    expect(finalPrice).toBe(100);
    expect(appendedTrace).toHaveLength(0);
  });

  it("applies a single 10% discount to a base price of 100", () => {
    const { finalPrice, appendedTrace } = applyPriceRules(
      100,
      [
        makeRule({
          ruleType: "Discount",
          amountType: "Percentage",
          amount: 0.1
        })
      ],
      "Net"
    );
    expect(finalPrice).toBe(90);
    expect(appendedTrace).toHaveLength(1);
    expect(appendedTrace[0].step).toBe("Discount");
    expect(appendedTrace[0].adjustment).toBe(-10);
  });

  it("applies a single fixed $15 discount to a base price of 100", () => {
    const { finalPrice } = applyPriceRules(
      100,
      [makeRule({ ruleType: "Discount", amountType: "Fixed", amount: 15 })],
      "Net"
    );
    expect(finalPrice).toBe(85);
  });

  it("picks the best discount when multiple discounts match (non-stacking)", () => {
    // 5% of 100 = 5 vs fixed 10 → fixed wins
    const { finalPrice, appendedTrace } = applyPriceRules(
      100,
      [
        makeRule({
          id: "r1",
          name: "5% off",
          ruleType: "Discount",
          amountType: "Percentage",
          amount: 0.05
        }),
        makeRule({
          id: "r2",
          name: "$10 off",
          ruleType: "Discount",
          amountType: "Fixed",
          amount: 10
        })
      ],
      "Net"
    );
    expect(finalPrice).toBe(90);
    // Only ONE discount entry in trace — non-stacking
    expect(appendedTrace.filter((t) => t.step === "Discount")).toHaveLength(1);
  });

  it("applies a single 20% surcharge to a base price of 100", () => {
    const { finalPrice } = applyPriceRules(
      100,
      [
        makeRule({
          ruleType: "Surcharge",
          amountType: "Percentage",
          amount: 0.2
        })
      ],
      "Net"
    );
    expect(finalPrice).toBe(120);
  });

  it("stacks multiple surcharges additively", () => {
    // 10% of 100 = 10, fixed 5 → 100 + 10 + 5 = 115
    const { finalPrice, appendedTrace } = applyPriceRules(
      100,
      [
        makeRule({
          id: "s1",
          name: "10% surcharge",
          ruleType: "Surcharge",
          amountType: "Percentage",
          amount: 0.1
        }),
        makeRule({
          id: "s2",
          name: "$5 surcharge",
          ruleType: "Surcharge",
          amountType: "Fixed",
          amount: 5
        })
      ],
      "Net"
    );
    expect(finalPrice).toBe(115);
    expect(appendedTrace.filter((t) => t.step === "Surcharge")).toHaveLength(2);
  });

  it("combines a discount and a surcharge", () => {
    // 100 - 10% discount (-10) = 90, then + $20 surcharge = 110
    const { finalPrice } = applyPriceRules(
      100,
      [
        makeRule({
          id: "d1",
          ruleType: "Discount",
          amountType: "Percentage",
          amount: 0.1
        }),
        makeRule({
          id: "s1",
          ruleType: "Surcharge",
          amountType: "Fixed",
          amount: 20
        })
      ],
      "Net"
    );
    expect(finalPrice).toBe(110);
  });

  it("skips discount rules when priceType is Discounted", () => {
    const { finalPrice, appendedTrace } = applyPriceRules(
      100,
      [
        makeRule({
          ruleType: "Discount",
          amountType: "Percentage",
          amount: 0.1
        })
      ],
      "Discounted"
    );
    expect(finalPrice).toBe(100);
    // The "Skipped" trace entry should be present
    expect(
      appendedTrace.some(
        (t) => t.step === "Discount" && t.source.includes("Skipped")
      )
    ).toBe(true);
  });

  it("still applies surcharges when priceType is Discounted", () => {
    const { finalPrice } = applyPriceRules(
      100,
      [
        makeRule({
          id: "d1",
          ruleType: "Discount",
          amountType: "Percentage",
          amount: 0.1
        }),
        makeRule({
          id: "s1",
          ruleType: "Surcharge",
          amountType: "Fixed",
          amount: 15
        })
      ],
      "Discounted"
    );
    expect(finalPrice).toBe(115);
  });

  it("clamps the final price to 0 (no negative prices)", () => {
    const { finalPrice } = applyPriceRules(
      100,
      [makeRule({ ruleType: "Discount", amountType: "Fixed", amount: 200 })],
      "Net"
    );
    expect(finalPrice).toBe(0);
  });

  it("orders trace entries: discount first, then surcharges", () => {
    const { appendedTrace } = applyPriceRules(
      100,
      [
        makeRule({
          id: "d1",
          ruleType: "Discount",
          amountType: "Percentage",
          amount: 0.1
        }),
        makeRule({
          id: "s1",
          ruleType: "Surcharge",
          amountType: "Fixed",
          amount: 5
        }),
        makeRule({
          id: "s2",
          ruleType: "Surcharge",
          amountType: "Fixed",
          amount: 10
        })
      ],
      "Net"
    );
    expect(appendedTrace[0].step).toBe("Discount");
    expect(appendedTrace[1].step).toBe("Surcharge");
    expect(appendedTrace[2].step).toBe("Surcharge");
  });
});
