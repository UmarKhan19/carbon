import { describe, expect, it } from "vitest";
import {
  isInterruptedBatchCandidate,
  isSessionExpired,
  QBWC_SESSION_EXPIRY_MS,
  type QbwcSession,
  selectInterruptedBatch
} from "../session";

const now = new Date("2026-07-11T12:00:00.000Z");

const seenAgo = (ms: number) => new Date(now.getTime() - ms).toISOString();

function makeSession(overrides: Partial<QbwcSession> = {}): QbwcSession {
  return {
    id: "qbwc-1",
    companyId: "comp-1",
    integration: "quickbooks-desktop",
    status: "Open",
    currentMessageSetId: null,
    claimedOperationIds: null,
    requestsSent: 0,
    qbxmlMajorVersion: null,
    lastSeenAt: seenAgo(0),
    closedAt: null,
    errorMessage: null,
    createdBy: "user-1",
    createdAt: seenAgo(60_000),
    updatedBy: null,
    updatedAt: null,
    ...overrides
  };
}

describe("isSessionExpired", () => {
  it("keeps a session live strictly inside the 30-minute window", () => {
    expect(isSessionExpired({ lastSeenAt: seenAgo(0), now })).toBe(false);
    expect(
      isSessionExpired({ lastSeenAt: seenAgo(QBWC_SESSION_EXPIRY_MS - 1), now })
    ).toBe(false);
  });

  it("expires at exactly the boundary and beyond", () => {
    expect(
      isSessionExpired({ lastSeenAt: seenAgo(QBWC_SESSION_EXPIRY_MS), now })
    ).toBe(true);
    expect(
      isSessionExpired({ lastSeenAt: seenAgo(QBWC_SESSION_EXPIRY_MS + 1), now })
    ).toBe(true);
  });

  it("treats a missing or invalid timestamp as expired (fail closed)", () => {
    expect(isSessionExpired({ lastSeenAt: null, now })).toBe(true);
    expect(isSessionExpired({ lastSeenAt: undefined, now })).toBe(true);
    expect(isSessionExpired({ lastSeenAt: "not-a-date", now })).toBe(true);
  });

  it("honors a custom expiry window", () => {
    expect(
      isSessionExpired({ lastSeenAt: seenAgo(5_000), now, expiryMs: 10_000 })
    ).toBe(false);
    expect(
      isSessionExpired({ lastSeenAt: seenAgo(10_000), now, expiryMs: 10_000 })
    ).toBe(true);
  });
});

describe("isInterruptedBatchCandidate", () => {
  const batch = { claimedOperationIds: ["op-1", "op-2"] };

  it("never flags a session without an in-flight batch", () => {
    for (const status of ["Open", "Closed", "Error"] as const) {
      expect(
        isInterruptedBatchCandidate(
          makeSession({ status, claimedOperationIds: null }),
          now
        )
      ).toBe(false);
      expect(
        isInterruptedBatchCandidate(
          makeSession({ status, claimedOperationIds: [] }),
          now
        )
      ).toBe(false);
    }
  });

  it("leaves a fresh Open session's batch alone — it may still be live", () => {
    expect(
      isInterruptedBatchCandidate(
        makeSession({ ...batch, lastSeenAt: seenAgo(60_000) }),
        now
      )
    ).toBe(false);
  });

  it("flags an Open session's batch once the session expiry passes", () => {
    expect(
      isInterruptedBatchCandidate(
        makeSession({ ...batch, lastSeenAt: seenAgo(QBWC_SESSION_EXPIRY_MS) }),
        now
      )
    ).toBe(true);
  });

  it("flags dead sessions' batches immediately (Error and Closed)", () => {
    // connectionError / hresult failure → Error; user cancelling QBWC
    // mid-batch → Closed. Either way the session cannot continue, and its
    // uncleared batch must be probed before those ops are ever re-sent.
    for (const status of ["Error", "Closed"] as const) {
      expect(
        isInterruptedBatchCandidate(
          makeSession({ ...batch, status, lastSeenAt: seenAgo(1_000) }),
          now
        )
      ).toBe(true);
    }
  });
});

describe("selectInterruptedBatch", () => {
  it("returns null when nothing qualifies", () => {
    expect(selectInterruptedBatch([], now)).toBeNull();
    expect(
      selectInterruptedBatch(
        [
          makeSession({ claimedOperationIds: null }),
          makeSession({
            claimedOperationIds: ["op-1"],
            lastSeenAt: seenAgo(60_000) // fresh Open — still live
          })
        ],
        now
      )
    ).toBeNull();
  });

  it("picks the most recently seen interrupted batch", () => {
    const older = makeSession({
      id: "qbwc-older",
      status: "Error",
      claimedOperationIds: ["op-1"],
      lastSeenAt: seenAgo(60 * 60_000)
    });
    const newer = makeSession({
      id: "qbwc-newer",
      status: "Error",
      claimedOperationIds: ["op-2"],
      lastSeenAt: seenAgo(10 * 60_000)
    });

    expect(selectInterruptedBatch([older, newer], now)?.id).toBe("qbwc-newer");
    expect(selectInterruptedBatch([newer, older], now)?.id).toBe("qbwc-newer");
  });

  it("skips non-candidates while selecting", () => {
    const live = makeSession({
      id: "qbwc-live",
      claimedOperationIds: ["op-1"],
      lastSeenAt: seenAgo(1_000) // fresh Open, newest — but still live
    });
    const crashed = makeSession({
      id: "qbwc-crashed",
      claimedOperationIds: ["op-2"],
      lastSeenAt: seenAgo(QBWC_SESSION_EXPIRY_MS + 60_000)
    });

    expect(selectInterruptedBatch([live, crashed], now)?.id).toBe(
      "qbwc-crashed"
    );
  });
});
