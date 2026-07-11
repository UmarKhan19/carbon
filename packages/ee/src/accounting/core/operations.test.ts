import { describe, expect, it } from "vitest";
import { SyncOperationStatusSchema } from "./models";
import {
  getClaimEntityTypeExclusion,
  getClaimEntityTypeFilterError,
  getSyncOperationTransitionError,
  isCooldownTrigger,
  isLiveSyncOperationStatus,
  SYNC_OPERATION_COOLDOWN_MS,
  shouldSkipForCooldown
} from "./operations";
import type { SyncOperationStatus, SyncOperationTrigger } from "./types";

const ALL_STATUSES = SyncOperationStatusSchema.options;

describe("getSyncOperationTransitionError", () => {
  // Retry (Failed/Warning → Pending), Skip (Failed/Warning/Pending →
  // Skipped), Re-send (Completed → Pending)
  const allowed: Array<[SyncOperationStatus, SyncOperationStatus]> = [
    ["Failed", "Pending"],
    ["Warning", "Pending"],
    ["Completed", "Pending"],
    ["Failed", "Skipped"],
    ["Warning", "Skipped"],
    ["Pending", "Skipped"]
  ];

  it("covers every from → to combination exhaustively", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const isAllowed = allowed.some(([f, t]) => f === from && t === to);
        const error = getSyncOperationTransitionError(from, to);

        if (isAllowed) {
          expect(error, `${from} → ${to} should be allowed`).toBeNull();
        } else {
          expect(error, `${from} → ${to} should be rejected`).toBe(
            `invalid transition ${from} → ${to}`
          );
        }
      }
    }
  });

  it("rejects transitions out of In Flight and Skipped entirely", () => {
    for (const to of ALL_STATUSES) {
      expect(getSyncOperationTransitionError("In Flight", to)).not.toBeNull();
      expect(getSyncOperationTransitionError("Skipped", to)).not.toBeNull();
    }
  });
});

describe("isLiveSyncOperationStatus", () => {
  it("absorbs re-triggers only into Pending and In Flight rows", () => {
    expect(isLiveSyncOperationStatus("Pending")).toBe(true);
    expect(isLiveSyncOperationStatus("In Flight")).toBe(true);
    expect(isLiveSyncOperationStatus("Completed")).toBe(false);
    expect(isLiveSyncOperationStatus("Failed")).toBe(false);
    expect(isLiveSyncOperationStatus("Warning")).toBe(false);
    expect(isLiveSyncOperationStatus("Skipped")).toBe(false);
  });
});

describe("shouldSkipForCooldown", () => {
  const now = new Date("2026-07-09T12:00:00.000Z");

  const completedAgo = (ms: number) =>
    new Date(now.getTime() - ms).toISOString();

  it("skips event/webhook re-triggers completed inside the cooldown", () => {
    for (const trigger of ["event", "webhook"] as const) {
      expect(
        shouldSkipForCooldown({
          trigger,
          completedAt: completedAgo(1_000),
          now
        })
      ).toBe(true);
      expect(
        shouldSkipForCooldown({
          trigger,
          completedAt: completedAgo(SYNC_OPERATION_COOLDOWN_MS - 1),
          now
        })
      ).toBe(true);
    }
  });

  it("does not skip once the cooldown has elapsed", () => {
    expect(
      shouldSkipForCooldown({
        trigger: "event",
        completedAt: completedAgo(SYNC_OPERATION_COOLDOWN_MS),
        now
      })
    ).toBe(false);
    expect(
      shouldSkipForCooldown({
        trigger: "webhook",
        completedAt: completedAgo(SYNC_OPERATION_COOLDOWN_MS + 1_000),
        now
      })
    ).toBe(false);
  });

  it("never skips backfill/manual/posting/retry triggers", () => {
    for (const trigger of [
      "backfill",
      "manual",
      "posting",
      "retry"
    ] as SyncOperationTrigger[]) {
      expect(isCooldownTrigger(trigger)).toBe(false);
      expect(
        shouldSkipForCooldown({
          trigger,
          completedAt: completedAgo(1_000),
          now
        })
      ).toBe(false);
    }
  });

  it("does not skip without a completed row or with an invalid timestamp", () => {
    expect(
      shouldSkipForCooldown({ trigger: "event", completedAt: null, now })
    ).toBe(false);
    expect(
      shouldSkipForCooldown({ trigger: "event", completedAt: undefined, now })
    ).toBe(false);
    expect(
      shouldSkipForCooldown({
        trigger: "event",
        completedAt: "not-a-date",
        now
      })
    ).toBe(false);
  });
});

describe("getClaimEntityTypeExclusion", () => {
  it("returns null when there is nothing to exclude", () => {
    expect(getClaimEntityTypeExclusion(undefined)).toBeNull();
    expect(getClaimEntityTypeExclusion([])).toBeNull();
  });

  it("formats a single entity type as a quoted PostgREST list", () => {
    // The daily-consolidation hold: journalEntry rows stay Pending for the
    // consolidation cron instead of being claimed by the drain
    expect(getClaimEntityTypeExclusion(["journalEntry"])).toBe(
      '("journalEntry")'
    );
  });

  it("formats multiple entity types comma-separated", () => {
    expect(getClaimEntityTypeExclusion(["journalEntry", "item"])).toBe(
      '("journalEntry","item")'
    );
  });
});

describe("getClaimEntityTypeFilterError", () => {
  it("allows an include-only claim (daily-consolidation cron)", () => {
    expect(
      getClaimEntityTypeFilterError({ entityTypes: ["journalEntry"] })
    ).toBeNull();
  });

  it("allows an exclude-only claim (drain holding journalEntry)", () => {
    expect(
      getClaimEntityTypeFilterError({ excludeEntityTypes: ["journalEntry"] })
    ).toBeNull();
  });

  it("allows an unfiltered claim", () => {
    expect(getClaimEntityTypeFilterError({})).toBeNull();
    expect(
      getClaimEntityTypeFilterError({ entityTypes: [], excludeEntityTypes: [] })
    ).toBeNull();
  });

  it("rejects combining the include and exclude filters", () => {
    expect(
      getClaimEntityTypeFilterError({
        entityTypes: ["journalEntry"],
        excludeEntityTypes: ["item"]
      })
    ).toBe(
      "entityTypes and excludeEntityTypes are mutually exclusive claim filters"
    );
  });
});
