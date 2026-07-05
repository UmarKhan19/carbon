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

import type {
  PeriodCloseTaskRow,
  PeriodReadinessCheck
} from "./accounting.service";
import {
  checklistTasksToCreate,
  closeAccountingPeriod,
  closePeriodWithChecklist,
  evaluateCloseChecklist,
  getOrCreateAccountingPeriod,
  postJournalEntry,
  reopenAccountingPeriod,
  skipCloseTask
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

// Like makeClient but records every `.update(values)` keyed by table, so tests
// can assert which rows a service persisted (and in what state), not just its
// return value. The shared response queue advances in issue order exactly as in
// makeClient; a fresh builder per `from(table)` carries the table name through.
function makeRecordingClient(responses: Scripted[]) {
  let i = 0;
  const next = () => responses[i++] ?? { data: null, error: null };
  const updates: { table: string; values: any }[] = [];
  const makeBuilder = (table: string) => {
    const builder: any = {
      select: () => builder,
      insert: () => builder,
      upsert: () => builder,
      update: (values: any) => {
        updates.push({ table, values });
        return builder;
      },
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
    return builder;
  };
  return { client: { from: (t: string) => makeBuilder(t) } as any, updates };
}

// The close path flips periodCloseTask + accountingPeriod through the Kysely
// client inside a single transaction. This records every `.set(values)` keyed
// by table so tests can assert the persisted state, mirroring the supabase
// recording client above. `.execute()` resolves empty — the service ignores the
// result and returns `{ id: periodId }` on a clean transaction.
function makeKyselyRecorder() {
  const updates: { table: string; values: any }[] = [];
  const tx = {
    updateTable(table: string) {
      const builder: any = {
        set: (values: any) => {
          updates.push({ table, values });
          return builder;
        },
        where: () => builder,
        execute: () => Promise.resolve([])
      };
      return builder;
    }
  };
  const db: any = {
    transaction: () => ({
      execute: async (fn: (t: unknown) => Promise<unknown>) => {
        await fn(tx);
      }
    })
  };
  return { db, updates };
}

const args = { periodId: "P2", companyId: "C1", userId: "U1" };

describe("closeAccountingPeriod — sequential close", () => {
  it("rejects closing period N while an earlier period is not Closed", async () => {
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Open" } },
      { count: 1 } // one earlier period still open
    ]);
    const { db } = makeKyselyRecorder();

    const result = await closeAccountingPeriod(client, db, args);

    expect(result.error).toBeTruthy();
    expect(result.error?.message).toMatch(/sequential close/i);
    expect(result.data).toBeNull();
  });

  it("allows closing when earlier periods are closed and the checklist is clear", async () => {
    // Query order after the sequential gate:
    //   getPeriodCloseChecklist: getAccountingPeriodById -> [definitions, tasks]
    //     -> readiness (4 parallel) ; then the period-flip update.
    const client = makeClient([
      { data: { id: "P2", startDate: "2026-02-01", closeStatus: "Open" } },
      { count: 0 }, // no earlier open periods
      {
        data: {
          id: "P2",
          startDate: "2026-02-01",
          endDate: "2026-02-28",
          closeStatus: "Open"
        }
      },
      { data: [] }, // active definitions (none configured)
      { data: [] }, // existing tasks (none)
      { count: 0 }, // readiness: draft journals
      { data: [] }, // readiness: posted journals in period
      { count: 0 }, // readiness: draft depreciation
      { count: 0 } // readiness: unmatched intercompany
    ]);
    // The period-flip write goes through the Kysely transaction, not supabase.
    const { db } = makeKyselyRecorder();

    const result = await closeAccountingPeriod(client, db, args);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "P2" });
  });
});

// ---------------------------------------------------------------------------
// closePeriodWithChecklist — the UI entry point (acceptance criteria 1/4).
//
// Delegates to closeAccountingPeriod, so it drives the full query graph:
//   getAccountingPeriodById -> earlierOpen count
//   -> getPeriodCloseChecklist(getAccountingPeriodById -> [definitions, tasks]
//      -> readiness: [draftJournals, journalsInPeriod, draftDepreciation, IC])
//   -> (per differing Auto task) periodCloseTask update
//   -> accountingPeriod flip.
// makeRecordingClient (above) records every `.update()` keyed by table so we can
// assert both the close-gate outcome and that final Auto-task states persist.
// ---------------------------------------------------------------------------

const openPeriod = { id: "P2", startDate: "2026-02-01", closeStatus: "Open" };
const openPeriodWithRange = {
  ...openPeriod,
  endDate: "2026-02-28"
};

describe("closePeriodWithChecklist — Blocker gate + Auto-task persistence", () => {
  it("rejects the close when a Blocker auto-check (draft JEs) is failing", async () => {
    const { client, updates } = makeRecordingClient([
      { data: openPeriod }, // getAccountingPeriodById
      { count: 0 }, // no earlier open periods
      { data: openPeriodWithRange }, // checklist: getAccountingPeriodById
      { data: [] }, // active definitions (already instantiated)
      {
        data: [
          {
            id: "auto1",
            companyId: "C1",
            accountingPeriodId: "P2",
            definitionId: "d1",
            name: "Post or re-date draft journal entries",
            taskType: "Auto",
            autoCheckKey: "draft-journals",
            sortOrder: 1,
            required: true,
            severity: "Blocker",
            status: "Open",
            assigneeId: null,
            completedBy: null,
            completedAt: null,
            skippedReason: null,
            notes: null
          }
        ]
      }, // existing tasks — no instantiation needed
      { count: 2 }, // readiness: draft journals present -> Blocker failing
      { data: [] }, // readiness: posted journals in period
      { count: 0 }, // readiness: draft depreciation
      { count: 0 } // readiness: unmatched intercompany
    ]);
    const { db, updates: txUpdates } = makeKyselyRecorder();

    const result = await closePeriodWithChecklist(client, db, args);

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/draft journal/i);
    // The close is rejected before the transaction opens, so nothing is
    // persisted through either client.
    expect(txUpdates).toHaveLength(0);
    expect(
      updates.some(
        (u) =>
          u.table === "accountingPeriod" && u.values.closeStatus === "Closed"
      )
    ).toBe(false);
  });

  it("persists the resolved Auto-task state, then closes, when checks pass", async () => {
    const { client } = makeRecordingClient([
      { data: openPeriod }, // getAccountingPeriodById
      { count: 0 }, // no earlier open periods
      { data: openPeriodWithRange }, // checklist: getAccountingPeriodById
      { data: [] }, // active definitions
      {
        data: [
          {
            id: "auto1",
            companyId: "C1",
            accountingPeriodId: "P2",
            definitionId: "d1",
            name: "Post or re-date draft journal entries",
            taskType: "Auto",
            autoCheckKey: "draft-journals",
            sortOrder: 1,
            required: true,
            severity: "Blocker",
            status: "Open", // stale Open; readiness now passes -> flips to Done
            assigneeId: null,
            completedBy: null,
            completedAt: null,
            skippedReason: null,
            notes: null
          }
        ]
      },
      { count: 0 }, // readiness: no draft journals -> Blocker passing
      { data: [] }, // readiness: posted journals in period
      { count: 0 }, // readiness: draft depreciation
      { count: 0 } // readiness: unmatched intercompany
    ]);
    // The task persist + period flip both run inside the Kysely transaction.
    const { db, updates: txUpdates } = makeKyselyRecorder();

    const result = await closePeriodWithChecklist(client, db, args);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "P2" });

    // Final Auto-task state persisted to periodCloseTask as Done.
    const taskUpdate = txUpdates.find((u) => u.table === "periodCloseTask");
    expect(taskUpdate?.values.status).toBe("Done");

    // Period flipped to Closed after the task state was flushed.
    const periodUpdate = txUpdates.find((u) => u.table === "accountingPeriod");
    expect(periodUpdate?.values.closeStatus).toBe("Closed");
    // The task write precedes the period flip within the transaction.
    expect(txUpdates.map((u) => u.table)).toEqual([
      "periodCloseTask",
      "accountingPeriod"
    ]);
  });
});

// ---------------------------------------------------------------------------
// Close checklist gating (acceptance criteria 6/9/10) — exercised as pure logic
// so the gate is verified without scripting a full query graph.
// ---------------------------------------------------------------------------

function task(overrides: Partial<PeriodCloseTaskRow>): PeriodCloseTaskRow {
  return {
    id: "T",
    companyId: "C1",
    accountingPeriodId: "P2",
    definitionId: "D",
    name: "Task",
    taskType: "Manual",
    autoCheckKey: null,
    sortOrder: 1,
    required: true,
    severity: null,
    status: "Open",
    assigneeId: null,
    completedBy: null,
    completedAt: null,
    skippedReason: null,
    notes: null,
    ...overrides
  };
}

const draftBlockerFailing: PeriodReadinessCheck = {
  autoCheckKey: "draft-journals",
  severity: "Blocker",
  label: "Draft journal entries dated in this period",
  failing: true,
  count: 2
};
const draftBlockerPassing: PeriodReadinessCheck = {
  ...draftBlockerFailing,
  failing: false,
  count: 0
};

describe("checklistTasksToCreate — idempotent instantiation (criterion 6)", () => {
  it("creates a task per definition on first run, none on re-run", () => {
    const defs = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];

    const first = checklistTasksToCreate(defs, []);
    expect(first.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);

    // Simulate the tasks that first-run would have created, then re-run.
    const existing = first.map((d) => ({ definitionId: d.id }));
    const second = checklistTasksToCreate(defs, existing);
    expect(second).toEqual([]);
  });
});

describe("evaluateCloseChecklist — close gate (criteria 7/10)", () => {
  it("blocks close when a required manual task is still Open", () => {
    const result = evaluateCloseChecklist(
      [task({ taskType: "Manual", status: "Open", name: "Review financials" })],
      []
    );
    expect(result.canClose).toBe(false);
    expect(result.blockingReason).toMatch(/Review financials/);
  });

  it("blocks close when a Blocker auto-check is failing", () => {
    const result = evaluateCloseChecklist(
      [
        task({
          taskType: "Auto",
          autoCheckKey: "draft-journals",
          severity: "Blocker",
          status: "Open",
          name: "Post or re-date draft journal entries"
        })
      ],
      [draftBlockerFailing]
    );
    expect(result.canClose).toBe(false);
    expect(result.blockingReason).toMatch(/draft journal/i);
  });

  it("allows close and persists the resolved Auto-task state when checks pass", () => {
    const result = evaluateCloseChecklist(
      [
        task({
          id: "auto1",
          taskType: "Auto",
          autoCheckKey: "draft-journals",
          severity: "Blocker",
          status: "Open"
        }),
        task({ taskType: "Manual", status: "Done" })
      ],
      [draftBlockerPassing]
    );
    expect(result.canClose).toBe(true);
    expect(result.autoTaskStates).toEqual([{ id: "auto1", status: "Done" }]);
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

// ---------------------------------------------------------------------------
// Source-aware posting gate (acceptance criteria 2/3)
//
// getOrCreateAccountingPeriod issues one query (getCurrentAccountingPeriod's
// `.single()`) to resolve the current period, then applies the close-status
// gate. An Active + Locked period rejects "operational" posting but still
// accepts "accounting" adjustments.
// ---------------------------------------------------------------------------

describe("getOrCreateAccountingPeriod — locked-period source gate", () => {
  it("rejects operational posting into a Locked period", async () => {
    const client = makeClient([
      { data: { id: "P2", status: "Active", closeStatus: "Locked" } }
    ]);

    const result = await getOrCreateAccountingPeriod(
      client,
      "C1",
      "2026-02-15",
      "operational"
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/locked/i);
  });

  it("allows accounting posting into a Locked period", async () => {
    const client = makeClient([
      { data: { id: "P2", status: "Active", closeStatus: "Locked" } }
    ]);

    const result = await getOrCreateAccountingPeriod(
      client,
      "C1",
      "2026-02-15",
      "accounting"
    );

    expect(result.error).toBeNull();
    expect(result.data).toBe("P2");
  });
});

// ---------------------------------------------------------------------------
// postJournalEntry now routes through the period gate (source "accounting").
// A balanced manual JE dated in a Closed period must be rejected — before the
// gate was wired in, the status flip proceeded regardless of period state.
//
// Query order: getJournalEntry `.single()` -> getCurrentAccountingPeriod
// `.single()` -> (only if the gate passes) the status-flip update `.single()`.
// ---------------------------------------------------------------------------

describe("postJournalEntry — period gate wiring", () => {
  const draftEntry = {
    data: {
      id: "J1",
      status: "Draft",
      companyId: "C1",
      postingDate: "2026-02-15",
      journalLine: [
        { amount: 100, account: { class: "Asset" } },
        { amount: 100, account: { class: "Liability" } }
      ]
    },
    error: null
  };

  it("rejects posting a balanced manual JE into a Closed period", async () => {
    const client = makeClient([
      draftEntry,
      { data: { id: "P2", status: "Active", closeStatus: "Closed" } }
    ]);

    const result = await postJournalEntry(client, "J1", "U1");

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/closed/i);
  });

  it("posts a balanced manual JE into a Locked period (accounting source)", async () => {
    const client = makeClient([
      draftEntry,
      { data: { id: "P2", status: "Active", closeStatus: "Locked" } },
      { data: { id: "J1" }, error: null }
    ]);

    const result = await postJournalEntry(client, "J1", "U1");

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "J1" });
  });
});

// ---------------------------------------------------------------------------
// skipCloseTask — Blocker skip rejection + empty-reason rejection (criteria 8/9)
// Query order: getPeriodCloseTaskById `.single()` -> (only if allowed) update.
// ---------------------------------------------------------------------------

describe("skipCloseTask — skip guards", () => {
  it("rejects an empty skip reason before touching the database", async () => {
    const client = makeClient([]);
    const result = await skipCloseTask(client, {
      taskId: "T1",
      companyId: "C1",
      userId: "U1",
      skippedReason: "   "
    });
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/reason is required/i);
  });

  it("rejects skipping a Blocker task", async () => {
    const client = makeClient([
      {
        data: {
          id: "T1",
          taskType: "Auto",
          severity: "Blocker",
          status: "Open"
        }
      }
    ]);
    const result = await skipCloseTask(client, {
      taskId: "T1",
      companyId: "C1",
      userId: "U1",
      skippedReason: "not applicable this month"
    });
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/cannot be skipped/i);
  });

  it("skips a Warning task with a recorded reason", async () => {
    const client = makeClient([
      {
        data: {
          id: "T2",
          taskType: "Auto",
          severity: "Warning",
          status: "Open"
        }
      },
      { data: { id: "T2" }, error: null } // update
    ]);
    const result = await skipCloseTask(client, {
      taskId: "T2",
      companyId: "C1",
      userId: "U1",
      skippedReason: "intercompany matched manually"
    });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "T2" });
  });
});
