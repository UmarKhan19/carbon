import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/form", () => ({ ValidatedForm: () => null }));
vi.mock("@carbon/react", () => ({
  Badge: () => null,
  Button: () => null,
  Card: () => null,
  CardContent: () => null,
  CardHeader: () => null,
  CardTitle: () => null,
  Drawer: () => null,
  DrawerBody: () => null,
  DrawerContent: () => null,
  DrawerFooter: () => null,
  DrawerHeader: () => null,
  DrawerTitle: () => null,
  HStack: () => null,
  VStack: () => null
}));
vi.mock("@carbon/utils", () => ({ formatDate: vi.fn() }));
vi.mock("@lingui/react/macro", () => ({
  Trans: () => null,
  useLingui: () => ({ t: (value: string) => value })
}));
vi.mock("@react-aria/i18n", () => ({ useLocale: () => ({ locale: "en-US" }) }));
vi.mock("react-icons/lu", () => ({
  LuChevronRight: () => null,
  LuExternalLink: () => null,
  LuHistory: () => null,
  LuRefreshCw: () => null,
  LuTriangle: () => null
}));
vi.mock("react-router", () => ({
  Link: () => null,
  useFetcher: () => ({ state: "idle" }),
  useRevalidator: () => ({ revalidate: vi.fn() })
}));
vi.mock("~/components", () => ({ EmployeeAvatar: () => null }));
vi.mock("~/components/Form", () => ({
  Boolean: () => null,
  Hidden: () => null,
  Select: () => null,
  Submit: () => null,
  TextArea: () => null,
  TextAreaControlled: () => null
}));
vi.mock("~/hooks", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("~/modules/items", () => ({
  changeNoticeImpactDecisionFormValidator: {},
  changeNoticeImpactDecisionStatuses: [
    "No action required",
    "Action required",
    "Resolved"
  ],
  changeNoticeStageFlow: [
    "Draft",
    "Start",
    "Engineering Complete",
    "Implementation",
    "Done"
  ]
}));
vi.mock("~/modules/production/ui/Jobs/JobStatus", () => ({
  default: () => null
}));
vi.mock("~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus", () => ({
  default: () => null
}));
vi.mock("~/utils/path", () => ({ path: { to: {} } }));
vi.mock("./ChangeNoticeStatus", () => ({ default: () => null }));
vi.mock("./ChangeNoticeImpactTasks", () => ({
  ChangeNoticeImpactTasks: () => null
}));
vi.mock("./ChangeNoticeImpactHistory", () => ({
  ChangeNoticeImpactHistory: () => null
}));

const {
  canViewChangeNoticeImpactHistory,
  getChangeNoticeImpactDecisionControls,
  getChangeNoticeImpactDecisionStatusOptions,
  getChangeNoticeImpactRationaleDefault
} = await import("./ChangeNoticeImpactWorkspace");

function candidate(over: Record<string, unknown> = {}) {
  return {
    targetType: "purchaseOrderLine",
    targetId: "pol-1",
    parent: null,
    item: null,
    currentSnapshot: { schema: "PO_LINE_SNAPSHOT_V1" },
    currentProvenance: [],
    historicalProvenance: [],
    provenance: [],
    exposureClassification: "Current operational exposure",
    sourceAvailability: "Present",
    unavailableReason: null,
    decision: null,
    freshness: null,
    taskLinks: [],
    ...over
  } as unknown as Parameters<
    typeof getChangeNoticeImpactDecisionControls
  >[0]["candidate"];
}

const base = {
  coverageStatus: "complete" as const,
  taskCoverageStatus: "complete" as const,
  changeNoticeStatus: "Implementation" as const,
  canUpdate: true
};

describe("Change Notice Impact decision controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows history only for a readable persisted decision", () => {
    const assessed = candidate({ decision: pendingCandidateDecision() });
    expect(canViewChangeNoticeImpactHistory(assessed)).toBe(true);
    expect(
      canViewChangeNoticeImpactHistory(
        candidate({
          decision: pendingCandidateDecision(),
          sourceAvailability: "Source deleted"
        })
      )
    ).toBe(true);
    expect(
      canViewChangeNoticeImpactHistory(
        candidate({
          decision: pendingCandidateDecision(),
          sourceAvailability: "Restricted"
        })
      )
    ).toBe(false);
    expect(
      canViewChangeNoticeImpactHistory(
        candidate({
          decision: pendingCandidateDecision(),
          sourceAvailability: "Unavailable"
        })
      )
    ).toBe(true);
    expect(canViewChangeNoticeImpactHistory(candidate())).toBe(false);
  });

  it("offers Assess and direct first-time Resolve only for current complete exposure", () => {
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate(),
        ...base
      })
    ).toEqual({
      assess: true,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          exposureClassification: "Historical reference"
        }),
        ...base
      })
    ).toMatchObject({
      assess: false,
      reassess: false,
      resolve: false
    });
  });

  it("offers Reassess for changed current decisions and Resolve for historical open work", () => {
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          decision: {
            status: "No action required",
            decisionStatus: "No action required",
            noActionReasonCode: "Not affected after review",
            rationale: "Reviewed",
            resolutionNote: null,
            id: "decision-1",
            revision: 2,
            snapshotVersion: 1,
            persistedSnapshot: null
          },
          freshness: "Changed since assessment"
        }),
        ...base
      })
    ).toMatchObject({
      assess: false,
      reassess: true,
      resolve: false
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          exposureClassification: "Historical reference",
          decision: {
            status: "Action required",
            decisionStatus: "Action required",
            noActionReasonCode: null,
            rationale: "Follow-up",
            resolutionNote: null,
            id: "decision-1",
            revision: 1,
            snapshotVersion: 1,
            persistedSnapshot: null
          },
          currentSnapshot: null
        }),
        ...base
      })
    ).toMatchObject({
      assess: false,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });
  });

  it("keeps Resolve visible but blocked when linked task evidence is incomplete or non-terminal", () => {
    const pending = getChangeNoticeImpactDecisionControls({
      candidate: candidate({
        decision: {
          status: "Action required",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "Follow-up",
          resolutionNote: null,
          id: "decision-1",
          revision: 1,
          snapshotVersion: 1,
          persistedSnapshot: null
        },
        taskLinks: [
          {
            decisionId: "decision-1",
            actionTaskId: "task-1",
            name: "Call supplier",
            status: "Pending",
            assignee: null,
            dueDate: null,
            taskOrigin: "Impact follow-up"
          }
        ]
      }),
      ...base
    });
    expect(pending).toMatchObject({
      reassess: true,
      resolve: true,
      resolveBlock: "nonTerminalTask"
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          decision: pendingCandidateDecision(),
          taskLinks: []
        }),
        ...base,
        taskCoverageStatus: "partial"
      })
    ).toMatchObject({ resolve: true, resolveBlock: "taskCoverage" });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate(),
        ...base,
        taskCoverageStatus: "partial"
      })
    ).toEqual({
      assess: true,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });
  });

  it.each([
    "Completed",
    "Skipped"
  ] as const)("allows existing Action required resolution when linked tasks are %s", (status) => {
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          decision: pendingCandidateDecision(),
          taskLinks: [
            {
              decisionId: "decision-1",
              actionTaskId: "task-1",
              name: "Supplier follow-up",
              status,
              assignee: null,
              dueDate: null,
              taskOrigin: "Manual"
            }
          ]
        }),
        ...base
      })
    ).toMatchObject({
      reassess: true,
      resolve: true,
      resolveBlock: null
    });
  });

  it("keeps existing Action required resolution available for unavailable sources", () => {
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          sourceAvailability: "Unavailable",
          exposureClassification: null,
          currentSnapshot: null,
          decision: pendingCandidateDecision()
        }),
        ...base
      })
    ).toEqual({
      assess: false,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });
  });

  it("does not offer a duplicate Resolved option in Assess or open Action required Reassess", () => {
    expect(getChangeNoticeImpactDecisionStatusOptions(null)).toEqual([
      "No action required",
      "Action required"
    ]);
    expect(
      getChangeNoticeImpactDecisionStatusOptions(pendingCandidateDecision())
    ).toEqual(["No action required", "Action required"]);
    expect(
      getChangeNoticeImpactDecisionStatusOptions(
        candidate({
          decision: {
            ...pendingCandidateDecision(),
            status: "No action required",
            decisionStatus: "No action required"
          }
        }).decision
      )
    ).toEqual(["No action required", "Action required"]);
    expect(
      getChangeNoticeImpactDecisionStatusOptions(
        candidate({
          decision: {
            ...pendingCandidateDecision(),
            status: "Resolved",
            decisionStatus: "Resolved"
          }
        }).decision
      )
    ).toEqual(["No action required", "Action required", "Resolved"]);
  });

  it("clears rationale for a changed conclusion while retaining it for same-state edits", () => {
    expect(
      getChangeNoticeImpactRationaleDefault({
        persistedStatus: "Action required",
        selectedStatus: "No action required",
        persistedRationale: "The old follow-up rationale."
      })
    ).toBe("");
    expect(
      getChangeNoticeImpactRationaleDefault({
        persistedStatus: "No action required",
        selectedStatus: "Action required",
        persistedRationale: "The old review rationale."
      })
    ).toBe("");
    expect(
      getChangeNoticeImpactRationaleDefault({
        persistedStatus: "Action required",
        selectedStatus: "Action required",
        persistedRationale: "The existing follow-up rationale."
      })
    ).toBe("The existing follow-up rationale.");
  });

  it("gates new conclusions while preserving Cancelled cleanup resolution", () => {
    const decision = pendingCandidateDecision();
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({ decision }),
        ...base,
        canUpdate: false
      })
    ).toEqual({
      assess: false,
      reassess: false,
      resolve: false,
      resolveBlock: null
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({ decision }),
        ...base,
        changeNoticeStatus: "Cancelled"
      })
    ).toMatchObject({
      assess: false,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate(),
        ...base,
        changeNoticeStatus: "Cancelled"
      })
    ).toEqual({
      assess: false,
      reassess: false,
      resolve: false,
      resolveBlock: null
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({ sourceAvailability: "Restricted", decision }),
        ...base
      })
    ).toEqual({
      assess: false,
      reassess: false,
      resolve: false,
      resolveBlock: null
    });
  });
});

function pendingCandidateDecision() {
  return {
    status: "Action required" as const,
    decisionStatus: "Action required" as const,
    noActionReasonCode: null,
    rationale: "Follow-up",
    resolutionNote: null,
    id: "decision-1",
    revision: 1,
    snapshotVersion: 1,
    persistedSnapshot: null
  };
}
