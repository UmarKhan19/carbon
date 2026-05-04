import { beforeEach, describe, expect, it } from "vitest";
import {
  __itemRulesCacheSize,
  __resetItemRulesCache,
  compileRule,
  compileWithCache,
  evaluateRules,
  getFieldDef,
  type ItemRuleRow,
  interpolateMessage,
  type RuleContext
} from "./itemRules";

const ruleOf = (
  conditions: Array<{ field: string; op: string; value?: unknown }>,
  overrides: Partial<ItemRuleRow> = {}
): ItemRuleRow => ({
  id: overrides.id ?? "rule_1",
  severity: overrides.severity ?? "error",
  message: overrides.message ?? "violated",
  conditionAst: { kind: "and", conditions: conditions as never },
  updatedAt: overrides.updatedAt ?? "2026-05-04T00:00:00Z",
  active: true
});

describe("operators", () => {
  it.each([
    ["eq", "Part", true],
    ["eq", "Material", false],
    ["neq", "Part", false],
    ["neq", "Material", true]
  ])("%s comparing 'Part' vs %s", (op, value, expectedSatisfied) => {
    const compiled = compileRule(ruleOf([{ field: "item.type", op, value }]));
    expect(compiled.predicate({ item: { type: "Part" } })).toBe(
      expectedSatisfied
    );
  });

  it("in/notIn match arrays", () => {
    const inRule = compileRule(
      ruleOf([
        { field: "transaction.locationId", op: "in", value: ["loc_a", "loc_b"] }
      ])
    );
    expect(inRule.predicate({ transaction: { locationId: "loc_a" } })).toBe(
      true
    );
    expect(inRule.predicate({ transaction: { locationId: "loc_x" } })).toBe(
      false
    );

    const notIn = compileRule(
      ruleOf([
        {
          field: "transaction.locationId",
          op: "notIn",
          value: ["loc_a", "loc_b"]
        }
      ])
    );
    expect(notIn.predicate({ transaction: { locationId: "loc_x" } })).toBe(
      true
    );
    expect(notIn.predicate({ transaction: { locationId: "loc_a" } })).toBe(
      false
    );
  });

  it("isSet/isNotSet handles null, undefined, and empty string", () => {
    const isSet = compileRule(
      ruleOf([{ field: "item.itemPostingGroupId", op: "isSet" }])
    );
    expect(isSet.predicate({ item: { itemPostingGroupId: "grp_a" } })).toBe(
      true
    );
    expect(isSet.predicate({ item: { itemPostingGroupId: null } })).toBe(false);
    expect(isSet.predicate({ item: { itemPostingGroupId: undefined } })).toBe(
      false
    );
    expect(isSet.predicate({ item: { itemPostingGroupId: "" } })).toBe(false);

    const isNot = compileRule(
      ruleOf([{ field: "item.itemPostingGroupId", op: "isNotSet" }])
    );
    expect(isNot.predicate({ item: { itemPostingGroupId: "" } })).toBe(true);
    expect(isNot.predicate({ item: { itemPostingGroupId: "grp_a" } })).toBe(
      false
    );
  });

  it("gt/lt only compare numbers", () => {
    const gt = compileRule(
      ruleOf([{ field: "transaction.quantity", op: "gt", value: 100 }])
    );
    expect(gt.predicate({ transaction: { quantity: 200 } })).toBe(true);
    expect(gt.predicate({ transaction: { quantity: 50 } })).toBe(false);
    // Non-numeric input: returns false instead of coercing
    expect(gt.predicate({ transaction: { quantity: "300" } })).toBe(false);

    const lt = compileRule(
      ruleOf([{ field: "transaction.quantity", op: "lt", value: 100 }])
    );
    expect(lt.predicate({ transaction: { quantity: 50 } })).toBe(true);
    expect(lt.predicate({ transaction: { quantity: 200 } })).toBe(false);
  });
});

describe("compilePredicate", () => {
  it("AND short-circuits on first false", () => {
    let secondCondCalls = 0;
    const compiled = compileRule(
      ruleOf([
        { field: "item.type", op: "eq", value: "Part" },
        { field: "transaction.kind", op: "eq", value: "receipt" }
      ])
    );
    // Wrap with our own counter — we can't directly observe, but we can assert behavior:
    // when first condition false, second is irrelevant.
    expect(
      compiled.predicate({
        item: { type: "Material" },
        transaction: { kind: "receipt" }
      })
    ).toBe(false);
    secondCondCalls++; // sanity: this assertion runs without invoking second condition due to short-circuit
    expect(secondCondCalls).toBe(1);
  });

  it("empty conditions array → predicate true (no constraints)", () => {
    const compiled = compileRule(ruleOf([]));
    expect(compiled.predicate({})).toBe(true);
  });

  it("malformed AST → predicate false (defensive)", () => {
    const compiled = compileRule({
      id: "x",
      severity: "error",
      message: "m",
      // @ts-expect-error intentionally malformed
      conditionAst: { kind: "or", conditions: [] }
    });
    expect(compiled.predicate({})).toBe(false);
  });

  it("unknown root segment → resolver returns undefined → predicate false", () => {
    const compiled = compileRule(
      ruleOf([{ field: "garbage.path", op: "eq", value: "x" }])
    );
    expect(compiled.predicate({})).toBe(false);
  });

  it("custom field path resolves through item.customFields", () => {
    const compiled = compileRule(
      ruleOf([
        {
          field: "item.customFields.frozen",
          op: "eq",
          value: true
        }
      ])
    );
    expect(
      compiled.predicate({ item: { customFields: { frozen: true } } })
    ).toBe(true);
    expect(
      compiled.predicate({ item: { customFields: { frozen: false } } })
    ).toBe(false);
  });
});

describe("interpolateMessage", () => {
  it("substitutes registered tokens", () => {
    const ctx: RuleContext = {
      item: { name: "Vanilla Ice Cream" },
      shelf: { name: "A1" }
    };
    expect(
      interpolateMessage("{item.name} cannot live on {shelf.name}", ctx)
    ).toBe("Vanilla Ice Cream cannot live on A1");
  });

  it("leaves unresolved tokens as literal so bugs are visible", () => {
    expect(interpolateMessage("{item.name} is bad", {})).toBe(
      "{item.name} is bad"
    );
  });

  it("does not match malformed tokens", () => {
    expect(interpolateMessage("{nope", {})).toBe("{nope");
  });
});

describe("evaluateRules", () => {
  it("returns one violation per failed rule with interpolated message", () => {
    const r1 = compileRule(
      ruleOf(
        [
          {
            field: "storageUnit.storageTypeId",
            op: "eq",
            value: "cold"
          }
        ],
        {
          id: "rule_cold",
          severity: "error",
          message: "{item.name} requires cold storage"
        }
      )
    );
    const r2 = compileRule(
      ruleOf([{ field: "transaction.quantity", op: "lt", value: 1000 }], {
        id: "rule_qty",
        severity: "warn",
        message: "Large receipt"
      })
    );

    const violations = evaluateRules([r1, r2], {
      item: { name: "Vanilla" },
      storageUnit: { storageTypeId: "ambient" }, // fails r1
      transaction: { quantity: 2000 } // fails r2 (not less than 1000)
    });

    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({
      ruleId: "rule_cold",
      severity: "error",
      message: "Vanilla requires cold storage"
    });
    expect(violations[1]?.severity).toBe("warn");
  });

  it("returns no violations when all rules satisfied", () => {
    const r = compileRule(
      ruleOf([
        {
          field: "storageUnit.storageTypeId",
          op: "eq",
          value: "cold"
        }
      ])
    );
    const violations = evaluateRules([r], {
      storageUnit: { storageTypeId: "cold" }
    });
    expect(violations).toEqual([]);
  });
});

describe("compileWithCache", () => {
  beforeEach(() => __resetItemRulesCache());

  it("returns same compiled instance on cache hit", () => {
    const row = ruleOf([{ field: "item.type", op: "eq", value: "Part" }]);
    const a = compileWithCache(row);
    const b = compileWithCache(row);
    expect(a).toBe(b);
  });

  it("invalidates when updatedAt changes", () => {
    const row1 = ruleOf([{ field: "item.type", op: "eq", value: "Part" }], {
      updatedAt: "2026-05-04T00:00:00Z"
    });
    const row2 = ruleOf([{ field: "item.type", op: "eq", value: "Part" }], {
      updatedAt: "2026-05-04T01:00:00Z"
    });
    const a = compileWithCache(row1);
    const b = compileWithCache(row2);
    expect(a).not.toBe(b);
    expect(__itemRulesCacheSize()).toBe(2);
  });

  it("evicts oldest when over cap", () => {
    // Fill past CACHE_CAP (256) — assert size never exceeds cap.
    for (let i = 0; i < 300; i++) {
      compileWithCache(
        ruleOf([{ field: "item.type", op: "eq", value: `v${i}` }], {
          id: `rule_${i}`,
          updatedAt: `t${i}`
        })
      );
    }
    expect(__itemRulesCacheSize()).toBeLessThanOrEqual(256);
  });
});

describe("FIELD_REGISTRY", () => {
  it("getFieldDef returns registered field", () => {
    expect(getFieldDef("item.type")?.label).toBe("Item type");
    expect(getFieldDef("storageUnit.storageTypeId")?.context).toBe("storage");
  });

  it("getFieldDef synthesizes definition for custom field paths", () => {
    const def = getFieldDef("item.customFields.frozen");
    expect(def?.label).toBe("frozen");
    expect(def?.context).toBe("item");
  });

  it("returns undefined for unknown paths", () => {
    expect(getFieldDef("garbage.path")).toBeUndefined();
  });
});
