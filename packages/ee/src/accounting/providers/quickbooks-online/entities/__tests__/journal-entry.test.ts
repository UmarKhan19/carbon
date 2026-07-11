import { describe, expect, it } from "vitest";
import {
  DEFAULT_POSTING_SYNC_SETTINGS,
  isJournalEntrySyncFailure,
  JournalEntrySyncError,
  type PostingSyncSettings,
  runJournalEntryPreflight
} from "../../../../core/posting";
import type { Accounting } from "../../../../core/types";
import { AccountingApiError } from "../../../../core/utils";
import type { Qbo } from "../../models";
import {
  extractQboErrorDetails,
  isQboAccountPeriodClosedError,
  QBO_FAULT_CODES
} from "../../provider";
import {
  getQboLockDate,
  mapJournalEntryToQboJournalEntry,
  toQboPeriodClosedError
} from "../journal-entry";
import { QBO_DOC_NUMBER_MAX_LENGTH } from "../shared";

// 3-line balanced fixture: Dr Inventory 150.00, Dr Freight 25.50,
// Cr GRNI accrual 175.50 (Carbon signed amounts: positive = debit)
const makeJournal = (
  overrides?: Partial<Accounting.JournalEntry>
): Accounting.JournalEntry => ({
  id: "je_123",
  companyId: "company-1",
  journalEntryId: "JE000042",
  description: "Receipt posting",
  postingDate: "2026-07-01",
  status: "Posted",
  sourceType: "Purchase Receipt",
  reversalOfId: null,
  reversedById: null,
  reversal: false,
  lines: [
    {
      id: "line-1",
      accountId: "acc-inventory",
      amount: 150,
      description: "Inventory"
    },
    { id: "line-2", accountId: "acc-freight", amount: 25.5, description: null },
    {
      id: "line-3",
      accountId: "acc-accrual",
      amount: -175.5,
      description: "GRNI accrual"
    }
  ],
  updatedAt: "2026-07-01T12:00:00.000Z",
  ...overrides
});

// Carbon account.id -> QBO AccountRef (mapping externalId = QBO Account.Id)
const ACCOUNT_REFS: ReadonlyMap<string, Qbo.Ref> = new Map([
  ["acc-inventory", { value: "84", name: "Inventory Asset" }],
  ["acc-freight", { value: "85", name: "Freight & Delivery" }],
  ["acc-accrual", { value: "86", name: "GRNI Accrual" }]
]);

// The shared pre-flight consumes account "codes"; for QBO that role is
// played by the account Id (the ref value) — same derivation as mapToRemote
const accountIdsByCarbonId = new Map(
  [...ACCOUNT_REFS].map(([accountId, ref]) => [accountId, ref.value] as const)
);

const makeSettings = (
  overrides?: Partial<PostingSyncSettings>
): PostingSyncSettings => ({
  ...DEFAULT_POSTING_SYNC_SETTINGS,
  enabled: true,
  ...overrides
});

function makeQboFaultError(code: string, message: string): AccountingApiError {
  const details = extractQboErrorDetails(400, "Bad Request", {
    Fault: {
      Error: [{ Message: message, Detail: `${message}.`, code, element: "" }],
      type: "ValidationFault"
    }
  });
  return new AccountingApiError("quickbooks", "create journal entry", details);
}

describe("mapJournalEntryToQboJournalEntry", () => {
  it("maps a 3-line journal to unsigned amounts with PostingType per Carbon sign (positive = debit)", () => {
    const payload = mapJournalEntryToQboJournalEntry({
      journal: makeJournal(),
      accountRefsById: ACCOUNT_REFS,
      pushDate: "2026-07-01"
    });

    expect(payload.DocNumber).toBe("JE000042");
    expect(payload.PrivateNote).toBe("Carbon JE000042 je_123");
    expect(payload.TxnDate).toBe("2026-07-01");
    expect(payload.Line).toEqual([
      {
        Amount: 150,
        DetailType: "JournalEntryLineDetail",
        Description: "Inventory",
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: { value: "84", name: "Inventory Asset" }
        }
      },
      {
        // Line without a description falls back to the journal description
        Amount: 25.5,
        DetailType: "JournalEntryLineDetail",
        Description: "Receipt posting",
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: { value: "85", name: "Freight & Delivery" }
        }
      },
      {
        Amount: 175.5,
        DetailType: "JournalEntryLineDetail",
        Description: "GRNI accrual",
        JournalEntryLineDetail: {
          PostingType: "Credit",
          AccountRef: { value: "86", name: "GRNI Accrual" }
        }
      }
    ]);
  });

  it("keeps the payload balanced: debit cents equal credit cents", () => {
    const payload = mapJournalEntryToQboJournalEntry({
      journal: makeJournal(),
      accountRefsById: ACCOUNT_REFS,
      pushDate: "2026-07-01"
    });

    const centsBySide = payload.Line.reduce(
      (sides, line) => {
        const side = line.JournalEntryLineDetail.PostingType;
        sides[side] += Math.round(line.Amount * 100);
        return sides;
      },
      { Debit: 0, Credit: 0 }
    );

    expect(centsBySide.Debit).toBe(centsBySide.Credit);
    expect(centsBySide.Debit).toBe(17550);
  });

  it("rounds every Amount to 2dp", () => {
    const payload = mapJournalEntryToQboJournalEntry({
      journal: makeJournal({
        lines: [
          {
            id: "line-1",
            accountId: "acc-inventory",
            amount: 10.567,
            description: null
          },
          {
            id: "line-2",
            accountId: "acc-accrual",
            amount: -10.567,
            description: null
          }
        ]
      }),
      accountRefsById: ACCOUNT_REFS,
      pushDate: "2026-07-01"
    });

    expect(payload.Line.map((line) => line.Amount)).toEqual([10.57, 10.57]);
  });

  it("flips every PostingType (amounts stay positive) and uses the reversal PrivateNote for reversal pushes", () => {
    const payload = mapJournalEntryToQboJournalEntry({
      journal: makeJournal({ status: "Reversed", reversal: true }),
      accountRefsById: ACCOUNT_REFS,
      pushDate: "2026-07-01"
    });

    expect(payload.PrivateNote).toBe("Carbon reversal of JE000042");
    expect(
      payload.Line.map((line) => line.JournalEntryLineDetail.PostingType)
    ).toEqual(["Credit", "Credit", "Debit"]);
    expect(payload.Line.map((line) => line.Amount)).toEqual([150, 25.5, 175.5]);
  });

  it("appends the original date to the PrivateNote when the push was re-dated", () => {
    const payload = mapJournalEntryToQboJournalEntry({
      journal: makeJournal(),
      accountRefsById: ACCOUNT_REFS,
      pushDate: "2026-07-02",
      redatedFromDate: "2026-07-01"
    });

    expect(payload.PrivateNote).toBe(
      "Carbon JE000042 je_123 | original date 2026-07-01"
    );
    expect(payload.TxnDate).toBe("2026-07-02");
  });

  it("keeps DocNumber at the 21-char boundary and omits it beyond (PrivateNote still carries the ids)", () => {
    const atCap = "X".repeat(QBO_DOC_NUMBER_MAX_LENGTH);
    const boundary = mapJournalEntryToQboJournalEntry({
      journal: makeJournal({ journalEntryId: atCap }),
      accountRefsById: ACCOUNT_REFS,
      pushDate: "2026-07-01"
    });
    expect(boundary.DocNumber).toBe(atCap);
    expect(boundary.PrivateNote).toBe(`Carbon ${atCap} je_123`);

    const overCap = "X".repeat(QBO_DOC_NUMBER_MAX_LENGTH + 1);
    const overflow = mapJournalEntryToQboJournalEntry({
      journal: makeJournal({ journalEntryId: overCap }),
      accountRefsById: ACCOUNT_REFS,
      pushDate: "2026-07-01"
    });
    expect(overflow.DocNumber).toBeUndefined();
    expect(overflow.PrivateNote).toBe(`Carbon ${overCap} je_123`);
  });

  it("throws the structured UNMAPPED_ACCOUNTS error when a line's account has no mapping", () => {
    let thrown: unknown;
    try {
      mapJournalEntryToQboJournalEntry({
        journal: makeJournal(),
        accountRefsById: new Map([
          ["acc-inventory", { value: "84" } satisfies Qbo.Ref]
        ]),
        pushDate: "2026-07-01"
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(JournalEntrySyncError);
    const failure = (thrown as JournalEntrySyncError).failure;
    expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(failure.warning).toBe(true);
    expect(failure.metadata?.unmappedAccountIds).toEqual(["acc-freight"]);
  });
});

describe("getQboLockDate (closed-books source)", () => {
  it("returns ONLY the manual settings.lockDate, normalized to YYYY-MM-DD", () => {
    expect(getQboLockDate(makeSettings({ lockDate: "2026-06-30" }))).toBe(
      "2026-06-30"
    );
    expect(
      getQboLockDate(makeSettings({ lockDate: "2026-06-30T00:00:00.000Z" }))
    ).toBe("2026-06-30");
  });

  it("returns null when no manual lock date is stored (the QBO API cannot read the close date)", () => {
    expect(getQboLockDate(makeSettings())).toBeNull();
  });
});

describe("closed-books pre-flight with the manual lock date", () => {
  it("parks the push (PERIOD_LOCKED warning) when the journal is dated on or before the lock date", () => {
    const settings = makeSettings({ lockDate: "2026-07-01" });

    const result = runJournalEntryPreflight({
      journal: makeJournal(), // dated 2026-07-01 — on the lock date
      accountCodesById: accountIdsByCarbonId,
      controlAccountIds: new Set<string>(),
      lockDate: getQboLockDate(settings),
      settings
    });

    expect(result.failure?.errorCode).toBe("PERIOD_LOCKED");
    expect(result.failure?.warning).toBe(true);
    expect(result.failure?.metadata).toEqual({
      postingDate: "2026-07-01",
      lockDate: "2026-07-01"
    });
  });

  it("re-dates to lock date + 1 under the redate policy and notes the original date in the PrivateNote", () => {
    const settings = makeSettings({
      lockDate: "2026-07-01",
      periodLockPolicy: "redate"
    });

    const preflight = runJournalEntryPreflight({
      journal: makeJournal(),
      accountCodesById: accountIdsByCarbonId,
      controlAccountIds: new Set<string>(),
      lockDate: getQboLockDate(settings),
      settings
    });

    expect(preflight).toEqual({
      failure: null,
      pushDate: "2026-07-02",
      redatedFromDate: "2026-07-01"
    });
    if (preflight.failure) throw new Error("preflight must pass");

    const payload = mapJournalEntryToQboJournalEntry({
      journal: makeJournal(),
      accountRefsById: ACCOUNT_REFS,
      pushDate: preflight.pushDate,
      redatedFromDate: preflight.redatedFromDate
    });

    expect(payload.TxnDate).toBe("2026-07-02");
    expect(payload.PrivateNote).toBe(
      "Carbon JE000042 je_123 | original date 2026-07-01"
    );
  });

  it("does not lock journals dated after the manual lock date", () => {
    const settings = makeSettings({ lockDate: "2026-06-30" });

    const result = runJournalEntryPreflight({
      journal: makeJournal(),
      accountCodesById: accountIdsByCarbonId,
      controlAccountIds: new Set<string>(),
      lockDate: getQboLockDate(settings),
      settings
    });

    expect(result.failure).toBeNull();
  });

  it("hard-fails an unbalanced journal (UNBALANCED_JOURNAL, warning: false) before any push", () => {
    const journal = makeJournal();
    const creditLine = journal.lines[2];
    if (!creditLine) throw new Error("fixture must have 3 lines");
    creditLine.amount = -175.49;

    const result = runJournalEntryPreflight({
      journal,
      accountCodesById: accountIdsByCarbonId,
      controlAccountIds: new Set<string>(),
      lockDate: null,
      settings: makeSettings()
    });

    expect(result.failure?.errorCode).toBe("UNBALANCED_JOURNAL");
    expect(result.failure?.warning).toBe(false);
  });
});

describe("toQboPeriodClosedError (6210 backstop for a stale manual lock date)", () => {
  it("converts QBO's Account Period Closed fault into the structured PERIOD_LOCKED Warning", () => {
    const fault = makeQboFaultError(
      QBO_FAULT_CODES.ACCOUNT_PERIOD_CLOSED,
      "Account Period Closed"
    );
    expect(isQboAccountPeriodClosedError(fault)).toBe(true);

    const converted = toQboPeriodClosedError(fault, {
      journalLabel: "JE000042",
      txnDate: "2026-07-01"
    });

    expect(converted).toBeInstanceOf(JournalEntrySyncError);
    expect(converted?.failure.errorCode).toBe("PERIOD_LOCKED");
    expect(converted?.failure.warning).toBe(true);
    expect(converted?.failure.metadata).toEqual({
      txnDate: "2026-07-01",
      qboFaultCode: QBO_FAULT_CODES.ACCOUNT_PERIOD_CLOSED
    });
    // The drain records the envelope, not a flattened string
    expect(isJournalEntrySyncFailure(converted?.failure)).toBe(true);
    expect(converted?.message).toContain("PERIOD_LOCKED");
  });

  it("returns null for other QBO faults and non-API errors", () => {
    const duplicateName = makeQboFaultError(
      QBO_FAULT_CODES.DUPLICATE_NAME_EXISTS,
      "Duplicate Name Exists Error"
    );
    expect(isQboAccountPeriodClosedError(duplicateName)).toBe(false);
    expect(
      toQboPeriodClosedError(duplicateName, { journalLabel: "JE000042" })
    ).toBeNull();

    expect(
      toQboPeriodClosedError(new Error("network down"), {
        journalLabel: "JE000042"
      })
    ).toBeNull();
  });
});
