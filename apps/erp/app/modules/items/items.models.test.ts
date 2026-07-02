import { describe, expect, it, vi } from "vitest";

// items.models transitively imports the shared/quality barrels, which pull in
// @carbon/glossary — whose terms.ts evaluates the Lingui `msg` macro at import.
// vitest doesn't run the macro transform, so stub it to a plain string builder.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "")
}));

const { evaluateApprovalThreshold, isAllowedChangeOrderTransition } =
  await import("./items.models");

describe("isAllowedChangeOrderTransition", () => {
  it("allows the happy-path forward transitions", () => {
    expect(isAllowedChangeOrderTransition("Draft", "In Review")).toBe(true);
    expect(isAllowedChangeOrderTransition("In Review", "Approved")).toBe(true);
  });

  it("forbids Approved → Released via the generic status guard", () => {
    // Release is reachable ONLY through releaseChangeOrder (which guards
    // status === "Approved" itself), never the generic status route.
    expect(isAllowedChangeOrderTransition("Approved", "Released")).toBe(false);
  });

  it("allows reject/cancel side transitions", () => {
    expect(isAllowedChangeOrderTransition("In Review", "Draft")).toBe(true);
    expect(isAllowedChangeOrderTransition("Approved", "Draft")).toBe(true);
    expect(isAllowedChangeOrderTransition("Draft", "Cancelled")).toBe(true);
    expect(isAllowedChangeOrderTransition("In Review", "Cancelled")).toBe(true);
    expect(isAllowedChangeOrderTransition("Approved", "Cancelled")).toBe(true);
  });

  it("rejects skipping a step", () => {
    expect(isAllowedChangeOrderTransition("Draft", "Approved")).toBe(false);
    expect(isAllowedChangeOrderTransition("Draft", "Released")).toBe(false);
    expect(isAllowedChangeOrderTransition("In Review", "Released")).toBe(false);
  });

  it("rejects transitions out of terminal states", () => {
    expect(isAllowedChangeOrderTransition("Released", "Draft")).toBe(false);
    expect(isAllowedChangeOrderTransition("Cancelled", "Draft")).toBe(false);
  });

  it("rejects no-op, unknown, and null transitions", () => {
    expect(isAllowedChangeOrderTransition("Draft", "Draft")).toBe(false);
    expect(isAllowedChangeOrderTransition("Bogus", "Draft")).toBe(false);
    expect(isAllowedChangeOrderTransition("Draft", "Bogus")).toBe(false);
    expect(isAllowedChangeOrderTransition(null, "Draft")).toBe(false);
    expect(isAllowedChangeOrderTransition("Draft", undefined)).toBe(false);
  });
});

const completed = (n: number) =>
  Array.from({ length: n }, () => ({ status: "Completed" as const }));
const pending = (n: number) =>
  Array.from({ length: n }, () => ({ status: "Pending" as const }));
const skipped = (n: number) =>
  Array.from({ length: n }, () => ({ status: "Skipped" as const }));

describe("evaluateApprovalThreshold", () => {
  it("returns false when there are no reviewers", () => {
    expect(evaluateApprovalThreshold("Unanimous", [])).toBe(false);
    expect(evaluateApprovalThreshold("Majority", [])).toBe(false);
    expect(evaluateApprovalThreshold("First-In", [])).toBe(false);
  });

  it("Unanimous requires every reviewer Completed", () => {
    expect(evaluateApprovalThreshold("Unanimous", completed(3))).toBe(true);
    expect(
      evaluateApprovalThreshold("Unanimous", [...completed(2), ...pending(1)])
    ).toBe(false);
  });

  it("Majority requires strictly more than half Completed", () => {
    expect(
      evaluateApprovalThreshold("Majority", [...completed(2), ...pending(1)])
    ).toBe(true);
    // 2 of 4 is exactly half — not a majority.
    expect(
      evaluateApprovalThreshold("Majority", [...completed(2), ...pending(2)])
    ).toBe(false);
    expect(
      evaluateApprovalThreshold("Majority", [...completed(3), ...pending(2)])
    ).toBe(true);
  });

  it("First-In passes on the first Completed decision", () => {
    expect(
      evaluateApprovalThreshold("First-In", [...completed(1), ...pending(4)])
    ).toBe(true);
    expect(evaluateApprovalThreshold("First-In", pending(3))).toBe(false);
  });

  // Skipped reviewers are a RECUSAL: excluded from the denominator entirely so a
  // Skip never makes Unanimous/Majority unreachable.
  describe("Skipped recusal", () => {
    it("returns false when EVERY reviewer is Skipped (no quorum left)", () => {
      expect(evaluateApprovalThreshold("Unanimous", skipped(3))).toBe(false);
      expect(evaluateApprovalThreshold("Majority", skipped(3))).toBe(false);
      expect(evaluateApprovalThreshold("First-In", skipped(3))).toBe(false);
    });

    it("Unanimous ignores Skipped rows in the denominator", () => {
      expect(
        evaluateApprovalThreshold("Unanimous", [...completed(2), ...skipped(1)])
      ).toBe(true);
      expect(
        evaluateApprovalThreshold("Unanimous", [
          ...completed(2),
          ...pending(1),
          ...skipped(1)
        ])
      ).toBe(false);
    });

    it("Majority is over half of the NON-skipped reviewers", () => {
      // Non-skipped total 4, completed 2 → 2*2 = 4, not > 4 → false.
      expect(
        evaluateApprovalThreshold("Majority", [
          ...completed(2),
          ...pending(2),
          ...skipped(1)
        ])
      ).toBe(false);
      // Non-skipped total 3, completed 2 → 4 > 3 → true.
      expect(
        evaluateApprovalThreshold("Majority", [
          ...completed(2),
          ...pending(1),
          ...skipped(2)
        ])
      ).toBe(true);
    });

    it("First-In still passes on one Completed amid Skipped rows", () => {
      expect(
        evaluateApprovalThreshold("First-In", [...completed(1), ...skipped(3)])
      ).toBe(true);
    });
  });
});
