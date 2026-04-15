import { describe, expect, it, vi } from "vitest";
import type { MatchedRule } from "./types";

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

const { applyPriceRules } = await import("./pricing.service");

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
    const { finalPrice, appendedTrace } = applyPriceRules(100, []);
    expect(finalPrice).toBe(100);
    expect(appendedTrace).toHaveLength(0);
  });

  it("applies a single 10% discount to a base price of 100", () => {
    const { finalPrice, appendedTrace } = applyPriceRules(100, [
      makeRule({
        ruleType: "Discount",
        amountType: "Percentage",
        amount: 0.1
      })
    ]);
    expect(finalPrice).toBe(90);
    expect(appendedTrace).toHaveLength(1);
    expect(appendedTrace[0].step).toBe("Discount");
    expect(appendedTrace[0].adjustment).toBe(-10);
  });

  it("applies a single fixed $15 discount", () => {
    const { finalPrice } = applyPriceRules(100, [
      makeRule({ ruleType: "Discount", amountType: "Fixed", amount: 15 })
    ]);
    expect(finalPrice).toBe(85);
  });

  it("picks the best discount when multiple match (non-stacking)", () => {
    const { finalPrice, appendedTrace } = applyPriceRules(100, [
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
    ]);
    expect(finalPrice).toBe(90);
    expect(appendedTrace.filter((t) => t.step === "Discount")).toHaveLength(1);
  });

  it("applies a single 20% markup", () => {
    const { finalPrice } = applyPriceRules(100, [
      makeRule({
        ruleType: "Markup",
        amountType: "Percentage",
        amount: 0.2
      })
    ]);
    expect(finalPrice).toBe(120);
  });

  it("stacks multiple markups additively", () => {
    const { finalPrice, appendedTrace } = applyPriceRules(100, [
      makeRule({
        id: "s1",
        name: "10% markup",
        ruleType: "Markup",
        amountType: "Percentage",
        amount: 0.1
      }),
      makeRule({
        id: "s2",
        name: "$5 markup",
        ruleType: "Markup",
        amountType: "Fixed",
        amount: 5
      })
    ]);
    expect(finalPrice).toBe(115);
    expect(appendedTrace.filter((t) => t.step === "Markup")).toHaveLength(2);
  });

  it("combines a discount and a markup", () => {
    const { finalPrice } = applyPriceRules(100, [
      makeRule({
        id: "d1",
        ruleType: "Discount",
        amountType: "Percentage",
        amount: 0.1
      }),
      makeRule({
        id: "s1",
        ruleType: "Markup",
        amountType: "Fixed",
        amount: 20
      })
    ]);
    expect(finalPrice).toBe(110);
  });

  it("clamps the final price to 0 (no negative prices)", () => {
    const { finalPrice } = applyPriceRules(100, [
      makeRule({ ruleType: "Discount", amountType: "Fixed", amount: 200 })
    ]);
    expect(finalPrice).toBe(0);
  });

  it("orders trace entries: discount first, then markups", () => {
    const { appendedTrace } = applyPriceRules(100, [
      makeRule({
        id: "d1",
        ruleType: "Discount",
        amountType: "Percentage",
        amount: 0.1
      }),
      makeRule({
        id: "s1",
        ruleType: "Markup",
        amountType: "Fixed",
        amount: 5
      }),
      makeRule({
        id: "s2",
        ruleType: "Markup",
        amountType: "Fixed",
        amount: 10
      })
    ]);
    expect(appendedTrace[0].step).toBe("Discount");
    expect(appendedTrace[1].step).toBe("Markup");
    expect(appendedTrace[2].step).toBe("Markup");
  });
});
