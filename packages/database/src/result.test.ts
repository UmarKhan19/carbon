import type { PostgrestError } from "@supabase/postgrest-js";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { fromQuery, fromTransaction } from "./result";

const postgrestError = (
  overrides: Partial<PostgrestError> = {}
): PostgrestError =>
  ({
    code: "XX000",
    message: "boom",
    details: "",
    hint: "",
    name: "PostgrestError",
    ...overrides
  }) as PostgrestError;

describe("fromQuery", () => {
  it("returns Ok with the data on success", async () => {
    const result = await fromQuery(
      Promise.resolve({ data: { id: "1" }, error: null })
    );
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ id: "1" });
  });

  it("maps a PostgrestError to a DatabaseError that preserves the raw error", async () => {
    const raw = postgrestError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "x"'
    });
    const result = await fromQuery(Promise.resolve({ data: null, error: raw }));
    expect(result.isErr()).toBe(true);
    result.match({
      ok: () => expect.unreachable(),
      err: (error) => {
        expect(error._tag).toBe("DatabaseError");
        // The generic message is shown; the raw constraint string never is.
        expect(error.messageDescriptor.id).toBe("error.database");
        expect(error.cause).toBe(raw);
      }
    });
  });

  it("maps a no-rows PostgrestError (PGRST116) to a NotFoundError when given entity context", async () => {
    const result = await fromQuery(
      Promise.resolve({
        data: null,
        error: postgrestError({ code: "PGRST116", message: "0 rows" })
      }),
      { entity: "Approval request", id: "abc" }
    );
    expect(result.isErr()).toBe(true);
    result.match({
      ok: () => expect.unreachable(),
      err: (error) => {
        expect(error._tag).toBe("NotFoundError");
        expect(error.values).toMatchObject({
          entity: "Approval request",
          id: "abc"
        });
      }
    });
  });

  it("maps a null row to a NotFoundError when given entity context", async () => {
    const result = await fromQuery(
      Promise.resolve({ data: null, error: null }),
      { entity: "Approval request" }
    );
    expect(result.isErr()).toBe(true);
    result.match({
      ok: () => expect.unreachable(),
      err: (error) => expect(error._tag).toBe("NotFoundError")
    });
  });
});

describe("fromTransaction", () => {
  const mockDb = (execute: (fn: (trx: unknown) => unknown) => unknown) =>
    ({
      transaction: () => ({ execute })
    }) as unknown as Kysely<unknown>;

  it("returns Ok with the transaction result on success", async () => {
    const db = mockDb(async (fn) => fn({ updated: true }));
    const result = await fromTransaction(db, async (trx) => trx);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ updated: true });
  });

  it("maps a thrown exception to a DatabaseError that preserves the cause", async () => {
    const thrown = new Error("connection reset");
    const db = mockDb(async () => {
      throw thrown;
    });
    const result = await fromTransaction(db, async (trx) => trx, {
      operation: "approveRequest"
    });
    expect(result.isErr()).toBe(true);
    result.match({
      ok: () => expect.unreachable(),
      err: (error) => {
        expect(error._tag).toBe("DatabaseError");
        expect(error.values).toEqual({ operation: "approveRequest" });
        expect(error.cause).toBe(thrown);
      }
    });
  });

  it("does not call execute lazily — it awaits the transaction", async () => {
    const execute = vi.fn(async (fn: (trx: unknown) => unknown) => fn("ok"));
    const db = mockDb(execute);
    await fromTransaction(db, async (trx) => trx);
    expect(execute).toHaveBeenCalledOnce();
  });
});
