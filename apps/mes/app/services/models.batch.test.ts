import { describe, expect, it } from "vitest";
import { batchCompleteValidator } from "./models";

// The Complete Batch form ships its variable-length per-member quantities as a
// single JSON field; the validator must parse + validate it into a typed array.
describe("batchCompleteValidator", () => {
  it("parses the JSON members array with quantities and scrap", () => {
    const result = batchCompleteValidator.safeParse({
      jobOperationBatchId: "bat_1",
      members: JSON.stringify([
        { jobOperationId: "op_1", quantity: 5 },
        { jobOperationId: "op_2", quantity: 20, scrapQuantity: 2 },
        { jobOperationId: "op_3", quantity: 10 }
      ])
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobOperationBatchId).toBe("bat_1");
      expect(result.data.members).toHaveLength(3);
      expect(result.data.members[1]).toEqual({
        jobOperationId: "op_2",
        quantity: 20,
        scrapQuantity: 2
      });
    }
  });

  it("rejects malformed JSON in the members field", () => {
    const result = batchCompleteValidator.safeParse({
      jobOperationBatchId: "bat_1",
      members: "not json"
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty members array", () => {
    const result = batchCompleteValidator.safeParse({
      jobOperationBatchId: "bat_1",
      members: "[]"
    });
    expect(result.success).toBe(false);
  });
});
