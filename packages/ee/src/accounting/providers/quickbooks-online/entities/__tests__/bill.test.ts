import { describe, expect, it } from "vitest";
import type { Qbo } from "../../models";
import { deriveCarbonBillStatus } from "../bill";
import { buildQboExpenseLines, type QboExpenseLineInput } from "../shared";

const ACCOUNT_REFS: ReadonlyMap<string, Qbo.Ref> = new Map([
  ["acc-freight", { value: "91", name: "Freight & Delivery" }]
]);

const itemLine: QboExpenseLineInput = {
  itemId: "item-1",
  accountId: null,
  description: "Widget Bracket",
  quantity: 10,
  unitPrice: 4.255,
  totalAmount: 42.555
};

const accountLine: QboExpenseLineInput = {
  itemId: null,
  accountId: "acc-freight",
  description: "Inbound freight",
  quantity: 1,
  unitPrice: 25,
  totalAmount: 25
};

describe("buildQboExpenseLines (bill mapping fixture)", () => {
  it("maps item lines to ItemBasedExpenseLineDetail and account lines to AccountBasedExpenseLineDetail", () => {
    const lines = buildQboExpenseLines({
      lines: [itemLine, accountLine],
      itemRemoteIds: new Map([["item-1", "77"]]),
      accountRefsById: ACCOUNT_REFS,
      documentLabel: "bill PI-000042"
    });

    expect(lines).toEqual([
      {
        Description: "Widget Bracket",
        Amount: 42.56,
        DetailType: "ItemBasedExpenseLineDetail",
        ItemBasedExpenseLineDetail: {
          ItemRef: { value: "77" },
          Qty: 10,
          UnitPrice: 4.255
        }
      },
      {
        Description: "Inbound freight",
        Amount: 25,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "91", name: "Freight & Delivery" }
        }
      }
    ]);
  });

  it("throws a plain error (Failed, not Warning) for a non-item line with an unmapped account", () => {
    expect(() =>
      buildQboExpenseLines({
        lines: [accountLine],
        itemRemoteIds: new Map(),
        accountRefsById: new Map(),
        documentLabel: "bill PI-000042"
      })
    ).toThrow(/account acc-freight has no QuickBooks Online account mapping/);
  });

  it("throws for a line with neither an item nor an account", () => {
    expect(() =>
      buildQboExpenseLines({
        lines: [{ ...accountLine, accountId: null }],
        itemRemoteIds: new Map(),
        accountRefsById: ACCOUNT_REFS,
        documentLabel: "bill PI-000042"
      })
    ).toThrow(/neither an item nor a G\/L account/);
  });

  it("throws for an item line whose item was not synced first", () => {
    expect(() =>
      buildQboExpenseLines({
        lines: [itemLine],
        itemRemoteIds: new Map(),
        accountRefsById: ACCOUNT_REFS,
        documentLabel: "bill PI-000042"
      })
    ).toThrow(/item item-1 has not been synced/);
  });
});

describe("deriveCarbonBillStatus (pull status from Balance/TotalAmt/DueDate)", () => {
  const now = new Date("2026-07-09T00:00:00.000Z");

  it("derives Paid / Partially Paid / Overdue / Open", () => {
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: 0,
        dueDate: "2026-07-01",
        now
      })
    ).toBe("Paid");
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: 40,
        dueDate: "2026-08-01",
        now
      })
    ).toBe("Partially Paid");
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: 100,
        dueDate: "2026-07-01",
        now
      })
    ).toBe("Overdue");
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: 100,
        dueDate: "2026-08-01",
        now
      })
    ).toBe("Open");
  });

  it("returns undefined when QBO reports no balance", () => {
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: undefined,
        dueDate: undefined,
        now
      })
    ).toBeUndefined();
  });
});
