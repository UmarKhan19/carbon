import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { describe, expect, it, vi } from "vitest";

// `shared.service` transitively imports `~/utils/query`, which imports
// `@carbon/auth` and evaluates its env config at import time (throwing without a
// full env). The approve/reject pre-flight paths under test don't use these
// helpers, so stub them to keep the import graph env-free.
vi.mock("~/utils/query", () => ({
  setGenericQueryFilters: () => ({})
}));
vi.mock("~/utils/supabase", () => ({
  sanitize: <T>(value: T) => value
}));

import { approveRequest, rejectRequest } from "./shared.service";

// A Kysely stand-in whose pre-flight `selectFrom(...).executeTakeFirst()`
// resolves to `row`. Only the pre-flight path is exercised here; NotFound and
// Conflict both return before any transaction runs.
function mockDb(row: unknown): Kysely<KyselyDatabase> {
  const chain = {
    select: () => chain,
    where: () => chain,
    executeTakeFirst: async () => row
  };
  return {
    selectFrom: () => chain
  } as unknown as Kysely<KyselyDatabase>;
}

describe("approveRequest", () => {
  it("returns a NotFoundError when the approval request does not exist", async () => {
    const result = await approveRequest(mockDb(undefined), "missing", "user-1");
    expect(result.isErr()).toBe(true);
    result.match({
      ok: () => expect.unreachable(),
      err: (error) => {
        expect(error._tag).toBe("NotFoundError");
        expect(error.values).toMatchObject({
          entity: "Approval request",
          id: "missing"
        });
      }
    });
  });

  it("returns a ConflictError when the request is no longer pending", async () => {
    const result = await approveRequest(
      mockDb({
        id: "req-1",
        status: "Approved",
        documentType: "purchaseOrder",
        documentId: "po-1",
        companyId: "c-1"
      }),
      "req-1",
      "user-1"
    );
    expect(result.isErr()).toBe(true);
    result.match({
      ok: () => expect.unreachable(),
      err: (error) => {
        expect(error._tag).toBe("ConflictError");
        // the message is the approvals-specific override, not the generic default
        expect(error.messageDescriptor.id).toBe("approvals.notPending");
      }
    });
  });
});

describe("rejectRequest", () => {
  it("returns a NotFoundError when the approval request does not exist", async () => {
    const result = await rejectRequest(mockDb(undefined), "missing", "user-1");
    expect(result.isErr()).toBe(true);
    result.match({
      ok: () => expect.unreachable(),
      err: (error) => expect(error._tag).toBe("NotFoundError")
    });
  });

  it("returns a ConflictError when the request is no longer pending", async () => {
    const result = await rejectRequest(
      mockDb({
        id: "req-1",
        status: "Rejected",
        documentType: "purchaseOrder",
        documentId: "po-1"
      }),
      "req-1",
      "user-1"
    );
    expect(result.isErr()).toBe(true);
    result.match({
      ok: () => expect.unreachable(),
      err: (error) => expect(error._tag).toBe("ConflictError")
    });
  });
});
