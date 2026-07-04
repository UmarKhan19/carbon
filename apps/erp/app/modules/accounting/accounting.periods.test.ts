import { describe, expect, it, vi } from "vitest";

// The settings barrel re-exports its UI, which transitively pulls Lingui `msg`
// macros that vitest does not transform. accounting.service only needs
// getNextSequence from it, which these tests never exercise — stub it to keep
// the import graph light and macro-free.
vi.mock("~/modules/settings", () => ({
  getNextSequence: vi.fn()
}));

// @carbon/glossary's terms.ts evaluates Lingui `msg` macros at module load,
// which vitest doesn't transform. Nothing under test touches the glossary, so
// stub the whole package.
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (t: string) => t,
  terms: {}
}));

import {
  closeAccountingPeriod,
  reopenAccountingPeriod
} from "./accounting.service";

// ---------------------------------------------------------------------------
// Sequential close / reverse-sequential reopen gates (acceptance criteria 4/5)
//
// These exercise the real service functions against a scripted fake supabase
// client. Each awaited query (or `.single()`) shifts the next scripted result
// off the queue, in the exact order the function issues them:
//   close:  getAccountingPeriodById -> earlierOpen count -> update
//   reopen: getAccountingPeriodById -> laterClosed count -> update
// ---------------------------------------------------------------------------

type Scripted = { data?: unknown; count?: number; error?: unknown };

function makeClient(responses: Scripted[]) {
  let i = 0;
  const next = () => responses[i++] ?? { data: null, error: null };
  const builder: any = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    eq: () => builder,
    neq: () => builder,
    lt: () => builder,
    gt: () => builder,
    gte: () => builder,
    lte: () => builder,
    or: () => builder,
    order: () => builder,
    single: () => Promise.resolve(next()),
    then: (resolve: (v: Scripted) => unknown) => resolve(next())
  };
  return { from: () => builder } as any;
}

const args = { periodId: "P2", companyId: "C1", userId: "U1" };

describe("closeAccountingPeriod — sequential close", () => {
  it("rejects closing period N while an earlier period is not Closed", async () => {
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Open" } },
      { count: 1 } // one earlier period still open
    ]);

    const result = await closeAccountingPeriod(client, args);

    expect(result.error).toBeTruthy();
    expect(result.error?.message).toMatch(/sequential close/i);
    expect(result.data).toBeNull();
  });

  it("allows closing when all earlier periods are Closed", async () => {
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Open" } },
      { count: 0 }, // no earlier open periods
      { data: { id: "P2" }, error: null } // update
    ]);

    const result = await closeAccountingPeriod(client, args);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "P2" });
  });
});

describe("reopenAccountingPeriod — reverse-sequential reopen", () => {
  it("rejects reopening period N while a later period is still Closed", async () => {
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Closed" } },
      { count: 1 } // a later period is still closed
    ]);

    const result = await reopenAccountingPeriod(client, args);

    expect(result.error).toBeTruthy();
    expect(result.error?.message).toMatch(/later periods must be reopened/i);
    expect(result.data).toBeNull();
  });

  it("allows reopening when no later period is Closed", async () => {
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Closed" } },
      { count: 0 }, // no later closed periods
      { data: { id: "P2" }, error: null } // update
    ]);

    const result = await reopenAccountingPeriod(client, args);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "P2" });
  });
});
