import {
  getPostingSyncSourceTypeSkipReason,
  type PostingSyncSettings,
  parseJournalEntrySyncEntityId,
  resolvePostingSyncSettings,
  runJournalEntryPreflight
} from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type { QbdJournalEntryInput } from "../qbxml/entities/journal-entry";
import * as journalEntry from "../qbxml/entities/journal-entry";
import type { QbxmlResponse } from "../qbxml/parse";
import {
  loadQbdAccountListIdsById,
  type QbdBuildRequestResult,
  QbdEntitySyncer,
  type QbdOperationInput,
  type QbdProcessResponseResult
} from "./shared";

/**
 * QbdJournalEntrySyncer — Posted Carbon journals → QuickBooks Desktop
 * JournalEntryAdd (push-only, Add-only; corrections push as reversing
 * entries). Transaction flow per entities/shared.ts: mapping exists →
 * idempotent completion; otherwise Add directly.
 *
 * Pre-flights run in buildRequest (freshest data), reusing core/posting
 * exactly like the Xero/QBO journal syncers:
 * - eligibility gates (status Posted / Reversed-with-original-mapping,
 *   posting sync enabled, sourceType rules) → `completed` with the reason
 *   (the REST drains close skips as Completed too);
 * - runJournalEntryPreflight with the account mapping resolved by ListID
 *   (getAccountMappings, integration "quickbooks-desktop" — the mapping's
 *   externalId IS the QB account ListID), the AR/AP control-account guard
 *   (accountDefault.receivablesAccount/payablesAccount), and the period
 *   lock against the MANUAL `settings.postingSync.lockDate` (like QBO,
 *   QuickBooks Desktop cannot report its closing date; a stale manual date
 *   surfaces as a 3170/3171 PERIOD_LOCKED Warning from QuickBooks itself)
 *   → `{ outcome: "failed", failure }`;
 * - the D4 builder's own guards (UNBALANCED_JOURNAL, UNMAPPED_ACCOUNTS)
 *   convert through the same envelope via runBuild.
 *
 * Reversal contract (shared with Xero/QBO): a sync entity id suffixed
 * ":reversal" loads the ORIGINAL journal, requires status Reversed plus an
 * existing original mapping, negates every signed line amount (flipping
 * debit/credit in the builder), and stores the reversal's mapping under
 * the suffixed entity id. RefNumber stays the plain journal number for
 * both pushes (QBO DocNumber parity); the Memo stamp carries the suffixed
 * entity id, which is what distinguishes the reversal in QuickBooks.
 *
 * Period-lock redate: when the redate policy moved the push date, the
 * original date is preserved on the FIRST line's description ("original
 * date <postingDate>") — QuickBooks journal entries have no header memo,
 * and the D4 builder folds the first line's description into its stamped
 * line memo.
 */

/**
 * The effective lock date (YYYY-MM-DD) for QuickBooks Desktop: the manual
 * `settings.lockDate` ONLY (same contract as QBO's getQboLockDate — the
 * desktop file's closing date is not readable over qbXML pre-flight).
 */
export function getQbdLockDate(settings: PostingSyncSettings): string | null {
  return settings.lockDate ? settings.lockDate.slice(0, 10) : null;
}

/**
 * Map one Carbon journal to the QBD JournalEntryAdd builder input. Pure —
 * exported for tests. Signed Carbon amounts pass through (negated for
 * reversals); the D4 builder splits debit/credit and asserts cent-exact
 * balance. Line descriptions fall back to the journal description; a
 * redate note is folded onto the first line.
 */
export function buildQbdJournalEntryInput(args: {
  journal: Accounting.JournalEntry;
  /** Sync entity id (suffixed ":reversal" for reversal pushes) → Memo. */
  entityId: string;
  accountListIdsById: ReadonlyMap<string, string>;
  pushDate: string;
  redatedFromDate?: string;
}): QbdJournalEntryInput {
  const { journal } = args;
  const sign = journal.reversal ? -1 : 1;

  const lines = journal.lines.map((line) => ({
    accountRef: {
      listId: line.accountId
        ? (args.accountListIdsById.get(line.accountId) ?? null)
        : null
    },
    amount: sign * line.amount,
    description: line.description ?? journal.description ?? null
  }));

  if (args.redatedFromDate && lines.length > 0) {
    const first = lines[0]!;
    const note = `original date ${args.redatedFromDate}`;
    first.description = first.description
      ? `${note} | ${first.description}`
      : note;
  }

  return {
    journalEntryId: journal.journalEntryId,
    entityId: args.entityId,
    postingDate: args.pushDate,
    lines
  };
}

export class QbdJournalEntrySyncer extends QbdEntitySyncer<Accounting.JournalEntry> {
  // Cached per instance — a QBWC batch reuses one syncer across its
  // claimed operations (same pattern as the QBO journal syncer)
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;
  private accountListIdsByIdPromise?: Promise<Map<string, string>>;
  private controlAccountIdsPromise?: Promise<Set<string>>;

  /**
   * Per-company posting-sync settings from
   * `companyIntegration.metadata.settings.postingSync`.
   */
  public getPostingSyncSettings(): Promise<PostingSyncSettings> {
    if (!this.postingSyncSettingsPromise) {
      this.postingSyncSettingsPromise = (async () => {
        const integration = await this.database
          .selectFrom("companyIntegration")
          .select("metadata")
          .where("id", "=", this.provider.id)
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return resolvePostingSyncSettings(integration?.metadata);
      })();
    }
    return this.postingSyncSettingsPromise;
  }

  /** Carbon account.id → QuickBooks account ListID (account mapping). */
  public getAccountListIdsById(): Promise<Map<string, string>> {
    if (!this.accountListIdsByIdPromise) {
      this.accountListIdsByIdPromise = loadQbdAccountListIdsById(
        this.database,
        { companyId: this.companyId, integration: this.provider.id }
      );
    }
    return this.accountListIdsByIdPromise;
  }

  /**
   * AR/AP control accounts (accountDefault.receivablesAccount /
   * payablesAccount) — journal lines on these never push. Also keeps
   * QuickBooks' one-AR/AP-line-per-journal rule unreachable.
   */
  public getControlAccountIds(): Promise<Set<string>> {
    if (!this.controlAccountIdsPromise) {
      this.controlAccountIdsPromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select(["receivablesAccount", "payablesAccount"])
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return new Set(
          [defaults?.receivablesAccount, defaults?.payablesAccount].filter(
            (id): id is string => typeof id === "string" && id.length > 0
          )
        );
      })();
    }
    return this.controlAccountIdsPromise;
  }

  /**
   * Eligibility gates (the QBO journal syncer's shouldSync rules): returns
   * the skip reason, or null when the journal should push.
   */
  private async getSkipReason(
    local: Accounting.JournalEntry
  ): Promise<string | null> {
    if (local.reversal) {
      if (local.status !== "Reversed") {
        return `Reversal push requires a Reversed journal (current status: ${local.status})`;
      }
      // Reversal-by-reference: only reverse what was actually pushed
      const originalMapping = await this.getMapping(local.id);
      if (!originalMapping?.externalId) {
        return `Original journal ${local.journalEntryId} was never pushed to QuickBooks Desktop; nothing to reverse`;
      }
    } else if (local.status !== "Posted") {
      return `Journal must be Posted before syncing (current status: ${local.status})`;
    }

    const settings = await this.getPostingSyncSettings();
    if (!settings.enabled) {
      return "Posting sync is not enabled for this integration";
    }

    return getPostingSyncSourceTypeSkipReason(local.sourceType, settings);
  }

  async buildRequest(op: QbdOperationInput): Promise<QbdBuildRequestResult> {
    return this.runBuild(async () => {
      // Idempotency: a mapped journal push (original OR reversal — the
      // reversal's mapping lives under the suffixed entity id) never
      // repeats
      const mapping = await this.getMapping(op.entityId);
      if (mapping?.externalId) {
        return {
          outcome: "completed",
          reason:
            "Journal already pushed to QuickBooks Desktop — skipping (idempotent)",
          externalId: mapping.externalId
        };
      }

      const local = await this.fetchLocal(op.entityId);
      if (!local) {
        throw new Error(`Journal ${op.entityId} not found in Carbon`);
      }

      const skipReason = await this.getSkipReason(local);
      if (skipReason) {
        return { outcome: "completed", reason: skipReason };
      }

      const settings = await this.getPostingSyncSettings();
      const accountListIdsById = await this.getAccountListIdsById();
      const controlAccountIds = await this.getControlAccountIds();

      const preflight = runJournalEntryPreflight({
        journal: local,
        accountCodesById: accountListIdsById,
        controlAccountIds,
        lockDate: getQbdLockDate(settings),
        settings
      });

      if (preflight.failure) {
        return { outcome: "failed", failure: preflight.failure };
      }

      return {
        outcome: "request",
        requestXml: journalEntry.buildAddRq({
          requestID: op.id,
          journalEntry: buildQbdJournalEntryInput({
            journal: local,
            entityId: op.entityId,
            accountListIdsById,
            pushDate: preflight.pushDate,
            redatedFromDate: preflight.redatedFromDate
          })
        }),
        phase: "add"
      };
    });
  }

  async processResponse(
    op: QbdOperationInput,
    response: QbxmlResponse
  ): Promise<QbdProcessResponseResult> {
    return this.processTxnResponse(op, response, {
      parseRet: journalEntry.parseRet,
      entityLabel: "journal entry"
    });
  }

  async fetchLocal(entityId: string): Promise<Accounting.JournalEntry | null> {
    const { journalId, reversal } = parseJournalEntrySyncEntityId(entityId);

    const journal = await this.database
      .selectFrom("journal")
      .select([
        "id",
        "companyId",
        "journalEntryId",
        "description",
        "postingDate",
        "status",
        "sourceType",
        "reversalOfId",
        "reversedById",
        "postedAt",
        "createdAt",
        "updatedAt"
      ])
      .where("id", "=", journalId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (!journal) return null;

    const lines = await this.database
      .selectFrom("journalLine")
      .select(["id", "accountId", "amount", "description"])
      .where("journalId", "=", journalId)
      .where("companyId", "=", this.companyId)
      .orderBy("journalLineReference", "asc")
      .execute();

    return {
      id: journal.id,
      companyId: journal.companyId,
      journalEntryId: journal.journalEntryId,
      description: journal.description ?? null,
      postingDate: journal.postingDate,
      status: journal.status,
      sourceType: journal.sourceType ?? null,
      reversalOfId: journal.reversalOfId ?? null,
      reversedById: journal.reversedById ?? null,
      reversal,
      lines: lines.map((line) => ({
        id: line.id,
        accountId: line.accountId ?? null,
        amount: Number(line.amount) || 0,
        description: line.description ?? null
      })),
      updatedAt: journal.updatedAt ?? journal.postedAt ?? journal.createdAt
    };
  }
}
