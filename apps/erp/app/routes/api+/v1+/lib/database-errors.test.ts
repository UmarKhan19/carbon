import { describe, expect, it } from "vitest";
import {
  classifyDatabaseFailure,
  DATABASE_ERROR_MESSAGES,
  publicDatabaseError
} from "./database-errors";

describe("classifyDatabaseFailure", () => {
  it.each([
    ["23505", "conflict"],
    ["23503", "reference"],
    ["23502", "required"],
    ["42501", "permission"],
    ["PGRST116", "notFound"]
  ] as const)("maps SQLSTATE %s to %s", (code, kind) => {
    expect(classifyDatabaseFailure({ code, message: "boom" })).toBe(kind);
  });

  it("maps an edge-function failure by its constructor name", () => {
    expect(
      classifyDatabaseFailure({ name: "FunctionsHttpError", context: {} })
    ).toBe("rule");
  });

  it("falls back to unknown for an unrecognized or absent code", () => {
    expect(classifyDatabaseFailure({ code: "XX000" })).toBe("unknown");
    expect(classifyDatabaseFailure({ message: "boom" })).toBe("unknown");
    expect(classifyDatabaseFailure(null)).toBe("unknown");
    expect(classifyDatabaseFailure(undefined)).toBe("unknown");
    expect(classifyDatabaseFailure("boom")).toBe("unknown");
  });

  it("classifies on structured fields, never on message text", () => {
    expect(
      classifyDatabaseFailure({ message: "duplicate key value violates 23505" })
    ).toBe("unknown");
  });
});

describe("publicDatabaseError", () => {
  it("returns only strings from the closed set", () => {
    const allowed = Object.values(DATABASE_ERROR_MESSAGES);
    for (const error of [
      {
        code: "23505",
        message: "duplicate key value violates unique constraint"
      },
      {
        code: "42501",
        details: "user 48e8db84 lacks privilege on table employee"
      },
      { name: "FunctionsHttpError", context: {} },
      { code: "XX000" },
      null
    ]) {
      expect(allowed).toContain(publicDatabaseError(error));
    }
  });

  it("leaks nothing from the underlying error", () => {
    const error = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "employee_email_key"',
      details: "Key (email)=(ceo@customer.example) already exists.",
      hint: "try another email"
    };
    const publicMessage = publicDatabaseError(error);

    expect(publicMessage).toBe(DATABASE_ERROR_MESSAGES.conflict);
    for (const secret of [
      "employee_email_key",
      "ceo@customer.example",
      "duplicate key",
      "email",
      "hint"
    ]) {
      expect(publicMessage).not.toContain(secret);
    }
  });

  it("never interpolates — every message is a constant", () => {
    for (const message of Object.values(DATABASE_ERROR_MESSAGES)) {
      expect(message).toMatch(/^Database error: [a-z]/);
      expect(message).not.toMatch(/[${}]/);
    }
  });
});
