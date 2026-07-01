import { describe, expect, it } from "vitest";
import { hashPinLookup, isValidPin } from "./pin.server";

describe("isValidPin", () => {
  it("accepts digit-only PINs within the length range", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12345678")).toBe(true);
  });

  it("rejects PINs that are too short, too long, or non-numeric", () => {
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("123456789")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("")).toBe(false);
    expect(isValidPin("12 4")).toBe(false);
  });
});

describe("hashPinLookup", () => {
  const pepper = "test-pepper";

  it("is deterministic for the same inputs", () => {
    expect(hashPinLookup("comp1", "1234", pepper)).toBe(
      hashPinLookup("comp1", "1234", pepper)
    );
  });

  it("produces a 64-char hex SHA-256 digest and never echoes the raw PIN", () => {
    const digest = hashPinLookup("comp1", "1234", pepper);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain("1234");
  });

  it("scopes uniqueness per company: same PIN, different company => different digest", () => {
    expect(hashPinLookup("comp1", "1234", pepper)).not.toBe(
      hashPinLookup("comp2", "1234", pepper)
    );
  });

  it("differs when the PIN differs", () => {
    expect(hashPinLookup("comp1", "1234", pepper)).not.toBe(
      hashPinLookup("comp1", "4321", pepper)
    );
  });

  it("differs when the pepper differs", () => {
    expect(hashPinLookup("comp1", "1234", pepper)).not.toBe(
      hashPinLookup("comp1", "1234", "other-pepper")
    );
  });

  it("throws when companyId or pepper is missing", () => {
    expect(() => hashPinLookup("", "1234", pepper)).toThrow();
    expect(() => hashPinLookup("comp1", "1234", "")).toThrow();
  });
});
