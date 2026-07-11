import { buildRequestElement } from "../envelope";
import { QbxmlValidationError } from "../errors";
import {
  buildAccountRefXml,
  buildCarbonMemo,
  buildTxnQueryRqXml,
  element,
  fitRefNumber,
  formatDate,
  parseTxnRet,
  type QbdRef,
  type QbdTxnQueryArgs,
  type QbdTxnRet
} from "./shared";

/**
 * JournalEntryAdd / JournalEntryQuery builders + JournalEntryRet parser
 * (push-only v1, no Mod — Carbon journals are immutable once Posted;
 * corrections push as reversing entries).
 *
 * Carbon sign convention (core JournalEntryLineSchema, same as the Xero
 * syncer): `amount` is signed, positive = debit, negative = credit. Each
 * line becomes a JournalDebitLine or JournalCreditLine with the ABSOLUTE
 * amount at 2dp; the debit and credit totals must match to the cent or
 * the builder throws the structured UNBALANCED_JOURNAL failure
 * (warning: false — corrupt input, same contract as
 * runJournalEntryPreflight).
 *
 * - TxnDate = the journal's postingDate.
 * - RefNumber = fitRefNumber(journalEntryId) (the readable journal
 *   number; omitted when over 11 chars).
 * - QuickBooks journal entries have NO header memo, so the Carbon stamp
 *   `Carbon <journalEntryId> <entityId>` rides the LINE memos: the first
 *   line always carries it (prefixed to its description when one exists);
 *   later lines use their description, falling back to the stamp.
 * - AccountRef per line by ListID from the account mapping
 *   (UNMAPPED_ACCOUNTS Warning when unmapped). AR/AP control-account
 *   lines never reach this builder (the shared pre-flight blocks them),
 *   which also keeps QuickBooks' one-AR/AP-line-per-journal rule
 *   unreachable.
 */

export interface QbdJournalLineInput {
  /** Mapped G/L account (ListID preferred; FullName pre-resolution). */
  accountRef: QbdRef;
  /** Signed Carbon amount: positive = debit, negative = credit. */
  amount: number;
  description?: string | null;
}

export interface QbdJournalEntryInput {
  /** Human-readable journal number (journal.journalEntryId). */
  journalEntryId: string;
  /** Carbon journal id (journal.id). */
  entityId: string;
  /** YYYY-MM-DD. */
  postingDate: string;
  lines: QbdJournalLineInput[];
}

export function buildAddRq(args: {
  requestID: string;
  journalEntry: QbdJournalEntryInput;
}): string {
  const { journalEntry } = args;
  if (journalEntry.lines.length === 0) {
    throw new Error(
      `Cannot build JournalEntryAdd for ${journalEntry.journalEntryId}: the journal has no lines`
    );
  }

  const memo = buildCarbonMemo(
    journalEntry.journalEntryId,
    journalEntry.entityId
  );

  let debitCents = 0;
  let creditCents = 0;
  const lineXml = journalEntry.lines
    .map((line, index) => {
      const magnitudeCents = Math.round(Math.abs(line.amount) * 100);
      const isDebit = line.amount >= 0;
      if (isDebit) {
        debitCents += magnitudeCents;
      } else {
        creditCents += magnitudeCents;
      }

      const lineMemo =
        index === 0
          ? line.description
            ? `${memo} | ${line.description}`
            : memo
          : (line.description ?? memo);

      const tag = isDebit ? "JournalDebitLine" : "JournalCreditLine";
      return `<${tag}>${buildAccountRefXml(
        "AccountRef",
        line.accountRef,
        `journal line ${index + 1}`
      )}${element("Amount", (magnitudeCents / 100).toFixed(2))}${element(
        "Memo",
        lineMemo
      )}</${tag}>`;
    })
    .join("");

  if (debitCents !== creditCents) {
    throw new QbxmlValidationError({
      errorCode: "UNBALANCED_JOURNAL",
      message: `Journal ${journalEntry.journalEntryId} does not balance: debits ${(
        debitCents / 100
      ).toFixed(2)} vs credits ${(creditCents / 100).toFixed(
        2
      )}; refusing to build JournalEntryAdd.`,
      warning: false,
      metadata: {
        journalEntryId: journalEntry.journalEntryId,
        entityId: journalEntry.entityId,
        debitTotal: debitCents / 100,
        creditTotal: creditCents / 100
      }
    });
  }

  const refNumber = fitRefNumber(journalEntry.journalEntryId);
  const inner = `<JournalEntryAdd>${element(
    "TxnDate",
    formatDate(journalEntry.postingDate)
  )}${refNumber ? element("RefNumber", refNumber) : ""}${lineXml}</JournalEntryAdd>`;

  return buildRequestElement("JournalEntryAddRq", args.requestID, inner);
}

export function buildQueryRq(args: QbdTxnQueryArgs): string {
  return buildTxnQueryRqXml("JournalEntryQueryRq", args);
}

export function parseRet(payload: unknown): QbdTxnRet | null {
  return parseTxnRet(payload, "JournalEntryRet");
}
