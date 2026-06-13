import { msg } from "@lingui/core/macro";
import { Result, TaggedError } from "better-result";
import { describe, expect, it } from "vitest";
import { createCarbonError } from "./error";
import {
  BusinessRuleError,
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  NotFoundError,
  ValidationError
} from "./errors";

describe("createCarbonError base", () => {
  it("produces a discriminable tag", () => {
    const error = new NotFoundError({ entity: "Approval request" });
    expect(error._tag).toBe("NotFoundError");
    expect(TaggedError.is(error)).toBe(true);
    expect(error).toBeInstanceOf(Error);
  });

  it("carries the class-level default descriptor", () => {
    const error = new NotFoundError({ entity: "Approval request" });
    expect(error.messageDescriptor).toEqual(error.defaultMessage);
    expect(error.messageDescriptor.id).toBe("error.notFound");
    expect(error.messageDescriptor.message).toBe("{entity} not found");
  });

  it("honors a call-site descriptor override", () => {
    const override = msg({
      id: "approvals.notPending",
      message: "Approval request is not pending"
    });
    const error = new ConflictError({
      entity: "Approval request",
      descriptor: override
    });
    expect(error.messageDescriptor.id).toBe("approvals.notPending");
    expect(error.messageDescriptor.message).toBe(
      "Approval request is not pending"
    );
  });

  it("exposes only serializable interpolation values (no meta)", () => {
    const error = new NotFoundError({ entity: "Approval request", id: "abc" });
    expect(error.values).toEqual({ entity: "Approval request", id: "abc" });
    // descriptor/cause are meta, not interpolation values
    expect("descriptor" in error.values).toBe(false);
    expect("cause" in error.values).toBe(false);
    expect(JSON.parse(JSON.stringify(error.values))).toEqual(error.values);
  });

  it("preserves an underlying cause for logging", () => {
    const raw = { code: "23505", message: "duplicate key" };
    const error = new DatabaseError({ operation: "insert", cause: raw });
    expect(error.cause).toBe(raw);
    // raw cause must never leak into the user-facing values
    expect(error.values).toEqual({ operation: "insert" });
  });

  it("is yieldable in Result.gen as a typed failure", () => {
    const program = Result.gen(function* () {
      const error = new NotFoundError({ entity: "Widget" });
      yield* Result.err(error);
      return Result.ok("unreachable");
    });
    expect(program.isErr()).toBe(true);
    program.match({
      ok: () => expect.unreachable(),
      err: (e) => expect(e._tag).toBe("NotFoundError")
    });
  });

  it("lets domain modules define their own errors on the same base", () => {
    class InsufficientQuantityError extends createCarbonError<
      "InsufficientQuantityError",
      { available: number; requested: number }
    >(
      "InsufficientQuantityError",
      msg({
        id: "inventory.insufficientQuantity",
        message: "Only {available} available, {requested} requested"
      })
    ) {}

    const error = new InsufficientQuantityError({
      available: 2,
      requested: 5
    });
    expect(error._tag).toBe("InsufficientQuantityError");
    expect(error.values).toEqual({ available: 2, requested: 5 });
    expect(error.messageDescriptor.id).toBe("inventory.insufficientQuantity");
  });
});

describe("the six core errors", () => {
  const cases = [
    [new NotFoundError({ entity: "X" }), "NotFoundError", "error.notFound"],
    [new ValidationError({}), "ValidationError", "error.validation"],
    [new ConflictError({}), "ConflictError", "error.conflict"],
    [new BusinessRuleError({}), "BusinessRuleError", "error.businessRule"],
    [new DatabaseError({}), "DatabaseError", "error.database"],
    [
      new ExternalServiceError({}),
      "ExternalServiceError",
      "error.externalService"
    ]
  ] as const;

  it.each(cases)("%o has the expected tag and default id", (error, tag, id) => {
    expect(error._tag).toBe(tag);
    expect(error.messageDescriptor.id).toBe(id);
    expect(typeof error.messageDescriptor.message).toBe("string");
  });
});
