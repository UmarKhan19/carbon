import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { triggerJobSchedule } from "~/modules/production/production.service";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import { action } from "./operations.update";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("~/modules/production/production.service", () => ({
  triggerJobSchedule: vi.fn()
}));

type QueryResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

function createActionMocks() {
  const events: string[] = [];
  const result: QueryResult = {
    data: { id: "operation-1" },
    error: null
  };
  const query = {
    update: vi.fn((_payload: unknown) => {
      events.push("update");
      return query;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      events.push(`eq:${column}:${String(value)}`);
      return query;
    }),
    select: vi.fn((columns: string) => {
      events.push(`select:${columns}`);
      return query;
    }),
    maybeSingle: vi.fn(async () => {
      events.push("maybeSingle");
      return result;
    })
  };
  const client = {
    from: vi.fn((table: string) => {
      events.push(`from:${table}`);
      return query;
    })
  };

  return { client, events, query, result };
}

type ActionMocks = ReturnType<typeof createActionMocks>;
let mocks: ActionMocks;

function updateRequest(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("http://localhost/x/schedule/operations/update", {
    method: "POST",
    body
  });
}

async function runAction(fields: Record<string, string>) {
  return action({
    request: updateRequest(fields),
    params: {},
    context: {}
  } as any);
}

const baseFields = {
  id: "operation-1",
  columnId: "work-center-2",
  priority: "-3.5"
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks = createActionMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client: mocks.client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
  vi.mocked(triggerJobSchedule).mockResolvedValue(undefined as never);
});

describe("Operations schedule update action", () => {
  it("completes the scoped update on the same chain without scheduling", async () => {
    const result = await runAction(baseFields);

    expect(mocks.client.from).toHaveBeenCalledWith("jobOperation");
    expect(mocks.query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        workCenterId: "work-center-2",
        priority: -3.5,
        updatedBy: "user-1"
      })
    );
    expect(mocks.events).toEqual([
      "from:jobOperation",
      "update",
      "eq:id:operation-1",
      "eq:companyId:company-1",
      "select:id",
      "maybeSingle"
    ]);
    expect(triggerJobSchedule).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("accepts finite negative priorities", async () => {
    await runAction({ ...baseFields, priority: "-100" });
    expect(mocks.query.update).toHaveBeenCalledWith(
      expect.objectContaining({ priority: -100 })
    );
  });

  it("accepts surrounding whitespace around a finite number", async () => {
    const result = await runAction({ ...baseFields, priority: " 4.25 " });

    expect(result).toEqual({ success: true });
    expect(mocks.query.update).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 4.25 })
    );
  });

  it.each([
    " ",
    "\t",
    "\n"
  ])("rejects whitespace-only priority %j before any database update", async (priority) => {
    const result = await runAction({ ...baseFields, priority });

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
  });

  it("rejects missing priority before any database update", async () => {
    const { priority: _priority, ...fields } = baseFields;
    const result = await runAction(fields);

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
  });

  it("rejects an empty priority before any database update", async () => {
    const result = await runAction({ ...baseFields, priority: "" });

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
  });

  it.each([
    "Infinity",
    "-Infinity",
    "NaN"
  ])("rejects non-finite priority %s", async (priority) => {
    const result = await runAction({ ...baseFields, priority });
    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
  });

  it("returns failure when no operation row was updated", async () => {
    mocks.result.data = null;

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Operation unavailable"
    });
    expect(mocks.events).toContain("maybeSingle");
  });

  it("returns the database error and never treats it as success", async () => {
    mocks.result.data = null;
    mocks.result.error = { message: "database failure" };

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "database failure"
    });
    expect(mocks.events).toContain("maybeSingle");
  });
});
