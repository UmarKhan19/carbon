import { describe, expect, it } from "vitest";
import {
  inventoryCountLineValidator,
  inventoryCountStatusType,
  inventoryCountValidator
} from "./inventory.models";

describe("inventoryCountStatusType", () => {
  it("enumerates the physical/cycle count lifecycle states", () => {
    expect(inventoryCountStatusType).toEqual([
      "Draft",
      "In Progress",
      "Posted",
      "Cancelled"
    ]);
  });
});

describe("inventoryCountValidator", () => {
  it("accepts a new count with no location (all active items)", () => {
    const r = inventoryCountValidator.safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts a count scoped to a location with a date and notes", () => {
    const r = inventoryCountValidator.safeParse({
      id: "ic1",
      countDate: "2026-07-05",
      locationId: "loc1",
      notes: "Q3 cycle count"
    });
    expect(r.success).toBe(true);
  });
});

describe("inventoryCountLineValidator", () => {
  it("requires a line id and accepts a counted quantity", () => {
    const r = inventoryCountLineValidator.safeParse({
      id: "icl1",
      countedQty: 12
    });
    expect(r.success).toBe(true);
  });

  it("rejects a line without an id", () => {
    const r = inventoryCountLineValidator.safeParse({ countedQty: 12 });
    expect(r.success).toBe(false);
  });

  it("rejects a negative counted quantity", () => {
    const r = inventoryCountLineValidator.safeParse({
      id: "icl1",
      countedQty: -1
    });
    expect(r.success).toBe(false);
  });
});
