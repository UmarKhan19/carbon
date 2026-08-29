import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const {
  classifyJobImpactEligibility,
  classifyJobMaterialImpactEligibility,
  classifyPurchaseOrderLineImpactEligibility,
  compareChangeNoticeImpactSnapshot,
  deriveChangeNoticeImpactProvenance,
  getChangeNoticeAffectedItems,
  getChangeNoticeImpactCandidates,
  normalizeJobImpactSnapshot,
  normalizeJobMaterialImpactSnapshot,
  normalizePurchaseOrderLineImpactSnapshot
} = await import("./items.service");
const {
  ACTIVE_JOB_MATERIAL,
  ACTIVE_PRODUCING_JOB,
  JOB_MATERIAL_SNAPSHOT_V1,
  JOB_SNAPSHOT_V1,
  OPEN_PURCHASING_COMMITMENT,
  PO_LINE_SNAPSHOT_V1,
  changeNoticeImpactDecisionStatuses,
  changeNoticeImpactNoActionReasonCodes,
  validateChangeNoticeImpactNoActionReason
} = await import("./items.models");

const companyId = "company-1";
const changeNoticeId = "cn-1";
const sourceAccess = {
  purchaseOrderLine: true,
  job: true,
  jobMaterial: true
};

function basePoInput(over: Record<string, unknown> = {}) {
  return {
    purchaseOrderLineId: "pol-1",
    purchaseOrderId: "po-1",
    supplierId: "supplier-1",
    itemId: "item-1",
    itemRevision: "A",
    purchaseOrderLineType: "Part",
    purchaseOrderStatus: "To Receive",
    receivedComplete: false,
    purchaseQuantity: 10,
    quantityReceived: 2,
    quantityToReceive: 8,
    purchaseUnitOfMeasureCode: "BOX",
    inventoryUnitOfMeasureCode: "EA",
    conversionFactor: 2,
    requiredDate: "2026-08-25",
    promisedDate: null,
    deliveryReceiptPromisedDate: null,
    deliveryRowPresent: true,
    ...over
  };
}

function baseJobInput(over: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    itemId: "item-1",
    itemRevision: "A",
    status: "In Progress",
    quantity: 100,
    productionQuantity: 110,
    quantityComplete: 20,
    quantityShipped: 10,
    quantityReceivedToInventory: 5,
    dueDate: "2026-08-30",
    effectiveMethodId: "job-method-1",
    effectiveMethodVersion: 2,
    unitOfMeasureCode: "EA",
    ...over
  };
}

function baseMaterialInput(over: Record<string, unknown> = {}) {
  return {
    jobMaterialId: "material-1",
    jobId: "job-1",
    itemId: "item-1",
    itemRevision: "A",
    jobStatus: "In Progress",
    estimatedQuantity: 5,
    quantityIssued: 5,
    quantityToIssue: 0,
    unitOfMeasureCode: "EA",
    methodType: "Pull from Inventory",
    jobOperationId: null,
    requiresBatchTracking: true,
    requiresSerialTracking: false,
    ...over
  };
}

function expectUnavailable(result: { sourceAvailability: string }) {
  expect(result.sourceAvailability).toBe("Unavailable");
}

describe("Change Notice Impact contracts", () => {
  it("keeps the exact target and persistent decision unions", () => {
    expect(changeNoticeImpactDecisionStatuses).toEqual([
      "No action required",
      "Action required",
      "Resolved"
    ]);
    expect(changeNoticeImpactNoActionReasonCodes).toEqual([
      "Outside effectivity",
      "Not affected after review",
      "No purchasing intervention remains"
    ]);
  });

  it("enforces reason applicability and rationale rules", () => {
    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure"
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: true,
          outsideEffectivity: true,
          ambiguous: false
        }
      }).valid
    ).toBe(true);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: true,
          outsideEffectivity: true,
          ambiguous: true
        }
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: true,
          outsideEffectivity: true,
          ambiguous: true
        },
        rationale: "The applicability evidence is ambiguous but was reviewed."
      }).valid
    ).toBe(true);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: false,
          decisionRelevant: true,
          outsideEffectivity: true,
          ambiguous: false
        }
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: false,
          outsideEffectivity: true,
          ambiguous: false
        }
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Outside effectivity",
        exposureClassification: "Current operational exposure",
        effectivityProof: {
          complete: true,
          decisionRelevant: true,
          outsideEffectivity: false,
          ambiguous: false
        }
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "job",
        reasonCode: "Not affected after review",
        exposureClassification: "Current operational exposure"
      }).valid
    ).toBe(false);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "purchaseOrderLine",
        reasonCode: "No purchasing intervention remains",
        exposureClassification: "Current operational exposure",
        purchasingInterventionConfirmation: {
          supplierReturnReviewed: true,
          replacementReviewed: true,
          creditReviewed: true,
          communicationReviewed: true,
          noInterventionRemains: true
        },
        rationale:
          "Supplier return, replacement, credit, and communication were reviewed."
      }).valid
    ).toBe(true);

    expect(
      validateChangeNoticeImpactNoActionReason({
        targetType: "purchaseOrderLine",
        reasonCode: "No purchasing intervention remains",
        exposureClassification: "Historical reference",
        rationale: "The line is complete."
      }).valid
    ).toBe(false);
  });

  it("classifies the supported lifecycle matrices without treating display statuses as lifecycle", () => {
    for (const status of [
      "Draft",
      "Planned",
      "Needs Approval",
      "To Review",
      "To Receive",
      "To Receive and Invoice",
      "To Invoice"
    ]) {
      expect(
        classifyPurchaseOrderLineImpactEligibility({
          purchaseOrderLineType: "Part",
          purchaseOrderStatus: status,
          receivedComplete: false,
          remainingQuantity: 1
        })
      ).toBe("Current operational exposure");
    }
    for (const status of ["Completed", "Closed", "Rejected"]) {
      expect(
        classifyPurchaseOrderLineImpactEligibility({
          purchaseOrderLineType: "Part",
          purchaseOrderStatus: status,
          receivedComplete: false,
          remainingQuantity: 1
        })
      ).toBe("Historical reference");
    }
    expect(
      classifyPurchaseOrderLineImpactEligibility({
        purchaseOrderLineType: "Part",
        purchaseOrderStatus: "Cancelled",
        receivedComplete: false,
        remainingQuantity: 1
      })
    ).toBe("Unavailable");

    for (const status of [
      "Draft",
      "Planned",
      "Ready",
      "In Progress",
      "Paused"
    ]) {
      expect(classifyJobImpactEligibility(status)).toBe(
        "Current operational exposure"
      );
    }
    for (const status of ["Completed", "Closed", "Cancelled"]) {
      expect(classifyJobImpactEligibility(status)).toBe("Historical reference");
    }
    expect(classifyJobImpactEligibility("Overdue")).toBe("Unavailable");
    expect(classifyJobMaterialImpactEligibility("In Progress")).toBe(
      "Current operational exposure"
    );
  });

  it("keeps accepted PO line types assessable and treats non-assessment types as historical", () => {
    for (const purchaseOrderLineType of [
      "Part",
      "Material",
      "Tool",
      "Consumable",
      "Fixture"
    ]) {
      expect(
        classifyPurchaseOrderLineImpactEligibility({
          purchaseOrderLineType,
          purchaseOrderStatus: "To Receive",
          receivedComplete: false,
          remainingQuantity: 1
        })
      ).toBe("Current operational exposure");
    }
    for (const purchaseOrderLineType of [
      "Comment",
      "G/L Account",
      "Fixed Asset",
      "Service"
    ]) {
      expect(
        classifyPurchaseOrderLineImpactEligibility({
          purchaseOrderLineType,
          purchaseOrderStatus: "To Receive",
          receivedComplete: false,
          remainingQuantity: 1
        })
      ).toBe("Historical reference");
    }
    expect(
      classifyPurchaseOrderLineImpactEligibility({
        purchaseOrderLineType: "Part",
        purchaseOrderStatus: "To Receive",
        receivedComplete: true,
        remainingQuantity: 1
      })
    ).toBe("Historical reference");
    expect(
      classifyPurchaseOrderLineImpactEligibility({
        purchaseOrderLineType: "Part",
        purchaseOrderStatus: "To Receive",
        receivedComplete: false,
        remainingQuantity: 0
      })
    ).toBe("Historical reference");
    expect(
      classifyPurchaseOrderLineImpactEligibility({
        purchaseOrderLineType: "Part",
        purchaseOrderStatus: "To Receive",
        receivedComplete: false,
        remainingQuantity: 0.000001,
        conversionFactor: 1
      })
    ).toBe("Historical reference");
  });
});

describe("Change Notice Impact snapshot normalizers", () => {
  it("normalizes PO quantities with Carbon precision and preserves explicit nulls", () => {
    const result = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({
        itemRevision: null,
        purchaseUnitOfMeasureCode: null,
        requiredDate: null,
        promisedDate: null,
        deliveryReceiptPromisedDate: "2026-08-31",
        purchaseQuantity: 1.234567,
        quantityReceived: 0.234567,
        quantityToReceive: 1
      })
    );
    expect(result.sourceAvailability).toBe("Present");
    if (result.sourceAvailability !== "Present") return;
    expect(Object.keys(result.snapshot)).toEqual([
      "schema",
      "purchaseOrderLineId",
      "purchaseOrderId",
      "supplierId",
      "itemId",
      "itemRevision",
      "purchaseOrderLineType",
      "purchaseOrderStatus",
      "receivedComplete",
      "orderedQuantity",
      "receivedQuantity",
      "remainingQuantity",
      "purchaseUnitOfMeasureCode",
      "inventoryUnitOfMeasureCode",
      "conversionFactor",
      "requiredDate",
      "promisedDate",
      "eligibilityBasis"
    ]);
    expect(result.snapshot).toMatchObject({
      schema: PO_LINE_SNAPSHOT_V1,
      orderedQuantity: 1.23457,
      receivedQuantity: 0.23457,
      remainingQuantity: 1,
      conversionFactor: 2,
      itemRevision: null,
      purchaseUnitOfMeasureCode: null,
      requiredDate: null,
      promisedDate: "2026-08-31",
      eligibilityBasis: OPEN_PURCHASING_COMMITMENT
    });
  });

  it("keeps PO snapshot quantities in purchase UOM while storing conversionFactor separately", () => {
    const result = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({
        purchaseQuantity: 10,
        quantityReceived: 2,
        quantityToReceive: 8,
        conversionFactor: 12
      })
    );
    expect(result.sourceAvailability).toBe("Present");
    if (result.sourceAvailability !== "Present") return;
    expect(result.snapshot).toMatchObject({
      orderedQuantity: 10,
      receivedQuantity: 2,
      remainingQuantity: 8,
      conversionFactor: 12
    });
    expect(result.snapshot).not.toMatchObject({
      orderedQuantity: 120,
      receivedQuantity: 24,
      remainingQuantity: 96
    });
  });

  it("canonicalizes conversion factors and rejects non-positive canonical values", () => {
    for (const [conversionFactor, expected] of [
      [null, 1],
      [1, 1],
      [1.234567, 1.23457],
      [0.000006, 0.00001]
    ] as const) {
      expect(
        normalizePurchaseOrderLineImpactSnapshot(
          basePoInput({ conversionFactor })
        )
      ).toMatchObject({
        sourceAvailability: "Present",
        snapshot: { conversionFactor: expected }
      });
    }

    for (const conversionFactor of [0, -1, 0.000001]) {
      expectUnavailable(
        normalizePurchaseOrderLineImpactSnapshot(
          basePoInput({ conversionFactor })
        )
      );
    }
  });

  it("rejects negative operational quantities in each supported snapshot", () => {
    for (const field of [
      "purchaseQuantity",
      "quantityReceived",
      "quantityToReceive"
    ]) {
      expectUnavailable(
        normalizePurchaseOrderLineImpactSnapshot(basePoInput({ [field]: -1 }))
      );
    }

    for (const field of [
      "quantity",
      "quantityComplete",
      "quantityShipped",
      "quantityReceivedToInventory"
    ]) {
      expectUnavailable(
        normalizeJobImpactSnapshot(baseJobInput({ [field]: -1 }))
      );
    }

    for (const field of [
      "estimatedQuantity",
      "quantityIssued",
      "quantityToIssue"
    ]) {
      expectUnavailable(
        normalizeJobMaterialImpactSnapshot(baseMaterialInput({ [field]: -1 }))
      );
    }

    // Method version is metadata, not an operational quantity. Its existing
    // numeric contract remains independent from the quantity guard.
    expect(
      normalizeJobImpactSnapshot(baseJobInput({ effectiveMethodVersion: 1.5 }))
        .sourceAvailability
    ).toBe("Present");
  });

  it("normalizes Jobs from quantity, not productionQuantity", () => {
    const result = normalizeJobImpactSnapshot(
      baseJobInput({
        quantity: 100,
        productionQuantity: 110,
        remainingQuantity: 999
      })
    );
    expect(result.sourceAvailability).toBe("Present");
    if (result.sourceAvailability !== "Present") return;
    expect(result.snapshot).toMatchObject({
      plannedQuantity: 100,
      completedQuantity: 20,
      remainingQuantity: 80
    });
  });

  it("requires planned quantity or job.quantity instead of productionQuantity", () => {
    const productionOnly = {
      ...baseJobInput(),
      plannedQuantity: undefined,
      quantity: undefined
    };
    expectUnavailable(normalizeJobImpactSnapshot(productionOnly));
  });

  it("normalizes Jobs with base status and excludes display-only fields", () => {
    const result = normalizeJobImpactSnapshot(
      baseJobInput({
        status: "Overdue",
        name: "display name",
        updatedAt: "later"
      })
    );
    expectUnavailable(result);

    const present = normalizeJobImpactSnapshot(baseJobInput());
    expect(present.sourceAvailability).toBe("Present");
    if (present.sourceAvailability !== "Present") return;
    expect(Object.keys(present.snapshot)).toEqual([
      "schema",
      "jobId",
      "itemId",
      "itemRevision",
      "status",
      "plannedQuantity",
      "completedQuantity",
      "remainingQuantity",
      "quantityShipped",
      "quantityReceivedToInventory",
      "dueDate",
      "effectiveMethodId",
      "effectiveMethodVersion",
      "unitOfMeasureCode",
      "eligibilityBasis"
    ]);
    expect(present.snapshot).toMatchObject({
      schema: JOB_SNAPSHOT_V1,
      status: "In Progress",
      plannedQuantity: 100,
      completedQuantity: 20,
      remainingQuantity: 80,
      effectiveMethodId: "job-method-1",
      effectiveMethodVersion: 2,
      eligibilityBasis: ACTIVE_PRODUCING_JOB
    });
  });

  it("normalizes Job Materials with generated remaining quantity and tracking", () => {
    const result = normalizeJobMaterialImpactSnapshot(baseMaterialInput());
    expect(result.sourceAvailability).toBe("Present");
    if (result.sourceAvailability !== "Present") return;
    expect(Object.keys(result.snapshot)).toEqual([
      "schema",
      "jobMaterialId",
      "jobId",
      "itemId",
      "itemRevision",
      "jobStatus",
      "requiredQuantity",
      "issuedQuantity",
      "remainingQuantity",
      "unitOfMeasureCode",
      "methodType",
      "jobOperationId",
      "requiresTracking",
      "eligibilityBasis"
    ]);
    expect(result.snapshot).toMatchObject({
      schema: JOB_MATERIAL_SNAPSHOT_V1,
      requiredQuantity: 5,
      issuedQuantity: 5,
      remainingQuantity: 0,
      jobOperationId: null,
      requiresTracking: { batch: true, serial: false },
      eligibilityBasis: ACTIVE_JOB_MATERIAL
    });
    expect(classifyJobMaterialImpactEligibility("In Progress")).toBe(
      "Current operational exposure"
    );
  });

  it("distinguishes explicit null from missing nullable issued quantity", () => {
    const explicitNull = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput({
        quantityIssued: null,
        itemRevision: null,
        unitOfMeasureCode: null
      })
    );
    expect(explicitNull.sourceAvailability).toBe("Present");
    if (
      explicitNull.sourceAvailability === "Present" &&
      explicitNull.snapshot.schema === JOB_MATERIAL_SNAPSHOT_V1
    ) {
      expect(Object.hasOwn(explicitNull.snapshot, "issuedQuantity")).toBe(true);
      expect(explicitNull.snapshot.issuedQuantity).toBeNull();
      expect(explicitNull.snapshot.itemRevision).toBeNull();
      expect(explicitNull.snapshot.unitOfMeasureCode).toBeNull();
    }

    const missingIssued = baseMaterialInput();
    Reflect.deleteProperty(missingIssued, "quantityIssued");
    expectUnavailable(normalizeJobMaterialImpactSnapshot(missingIssued));

    for (const value of [undefined, ""]) {
      expectUnavailable(
        normalizeJobMaterialImpactSnapshot(
          baseMaterialInput({ quantityIssued: value })
        )
      );
    }

    const numeric = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput({ quantityIssued: 2.5 })
    );
    expect(numeric.sourceAvailability).toBe("Present");
    if (
      numeric.sourceAvailability === "Present" &&
      numeric.snapshot.schema === JOB_MATERIAL_SNAPSHOT_V1
    ) {
      expect(numeric.snapshot.issuedQuantity).toBe(2.5);
    }

    expectUnavailable(
      normalizeJobMaterialImpactSnapshot(
        baseMaterialInput({ quantityIssued: -0.000001 })
      )
    );
  });

  it("returns Unavailable for missing required facts and unknown snapshot versions", () => {
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ quantityToReceive: null })
      )
    );
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ requiredDate: "2026-99-99" })
      )
    );
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ purchaseUnitOfMeasureCode: 42 })
      )
    );
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ purchaseUnitOfMeasureCode: undefined })
      )
    );
    expectUnavailable(
      normalizePurchaseOrderLineImpactSnapshot(
        basePoInput({ requiredDate: undefined })
      )
    );
    expectUnavailable(
      normalizeJobImpactSnapshot(baseJobInput({ effectiveMethodId: null }))
    );
    expectUnavailable(
      normalizeJobMaterialImpactSnapshot(
        baseMaterialInput({ requiresBatchTracking: undefined })
      )
    );
    expectUnavailable(
      normalizeJobMaterialImpactSnapshot(
        baseMaterialInput({ jobOperationId: 42 })
      )
    );

    const current = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    expect(current.sourceAvailability).toBe("Present");
    if (current.sourceAvailability !== "Present") return;
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        current.snapshot,
        current.snapshot,
        2
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        current.snapshot,
        { ...current.snapshot, cosmeticLabel: "ignored?" },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        current.snapshot,
        { ...current.snapshot, itemRevision: "" },
        1
      )
    ).toBe("Unknown");
  });

  it("detects meaningful changes but ignores updatedAt/display-only source fields", () => {
    const current = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    const stored = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({ name: "old display", updatedAt: "old" })
    );
    expect(current.sourceAvailability).toBe("Present");
    expect(stored.sourceAvailability).toBe("Present");
    if (
      current.sourceAvailability !== "Present" ||
      stored.sourceAvailability !== "Present"
    ) {
      return;
    }
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        current.snapshot,
        stored.snapshot,
        1
      )
    ).toBe("Current");
    const changed = normalizePurchaseOrderLineImpactSnapshot(
      basePoInput({ quantityReceived: 3 })
    );
    expect(changed.sourceAvailability).toBe("Present");
    if (changed.sourceAvailability !== "Present") return;
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        changed.snapshot,
        stored.snapshot,
        1
      )
    ).toBe("Changed since assessment");
  });

  it("rejects non-canonical and negative persisted quantity evidence", () => {
    const po = normalizePurchaseOrderLineImpactSnapshot(basePoInput());
    const job = normalizeJobImpactSnapshot(baseJobInput());
    const material = normalizeJobMaterialImpactSnapshot(baseMaterialInput());
    const materialWithNull = normalizeJobMaterialImpactSnapshot(
      baseMaterialInput({ quantityIssued: null })
    );
    expect(po.sourceAvailability).toBe("Present");
    expect(job.sourceAvailability).toBe("Present");
    expect(material.sourceAvailability).toBe("Present");
    expect(materialWithNull.sourceAvailability).toBe("Present");
    if (
      po.sourceAvailability !== "Present" ||
      job.sourceAvailability !== "Present" ||
      material.sourceAvailability !== "Present" ||
      materialWithNull.sourceAvailability !== "Present"
    ) {
      return;
    }

    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        po.snapshot,
        { ...po.snapshot, orderedQuantity: 10.000001 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        po.snapshot,
        { ...po.snapshot, orderedQuantity: -1 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        po.snapshot,
        { ...po.snapshot, conversionFactor: 0 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "purchaseOrderLine",
        po.snapshot,
        { ...po.snapshot, purchaseOrderLineId: "pol-other" },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "job",
        job.snapshot,
        { ...job.snapshot, plannedQuantity: 100.000001 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "job",
        job.snapshot,
        { ...job.snapshot, remainingQuantity: 999 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "job",
        job.snapshot,
        { ...job.snapshot, effectiveMethodVersion: 2.000001 },
        1
      )
    ).toBe("Unknown");
    expect(
      compareChangeNoticeImpactSnapshot(
        "jobMaterial",
        material.snapshot,
        { ...material.snapshot, requiredQuantity: 5.000001 },
        1
      )
    ).toBe("Unknown");
    if (materialWithNull.snapshot.schema !== JOB_MATERIAL_SNAPSHOT_V1) {
      return;
    }
    expect(
      compareChangeNoticeImpactSnapshot(
        "jobMaterial",
        materialWithNull.snapshot,
        { ...materialWithNull.snapshot, issuedQuantity: null },
        1
      )
    ).toBe("Current");
  });
});

describe("Change Notice Impact provenance", () => {
  it("keeps current and historical causes separate in a database-valid state", () => {
    const result = deriveChangeNoticeImpactProvenance({
      sourceItemId: "item-1",
      currentAffectedItems: [
        { id: "affected-1", itemId: "item-1", label: "PART-A" }
      ],
      persistedProvenance: [
        {
          affectedItemId: "removed",
          affectedItemSourceId: "item-old",
          affectedItemLabel: null,
          endedAt: "2026-08-24T00:00:00Z",
          endedReason: "Affected item removed from Change Notice"
        }
      ]
    });
    expect(result.currentProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "affected-1",
        status: "Current"
      })
    ]);
    expect(result.historicalProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "removed",
        affectedItemLabel: "Affected item",
        status: "Historical",
        endedReason: "Affected item removed from Change Notice"
      })
    ]);
  });
});

type FakeRow = Record<string, unknown>;

// PostgreSQL's verified en_US.UTF-8 order for Carbon's Base58 alphabet.
const VERIFIED_DATABASE_BASE58_ORDER =
  "123456789aAbBcCdDeEfFgGhHijJkKLmMnNopPqQrRsStTuUvVwWxXyYzZ";
const databaseBase58Ranks = new Map(
  [...VERIFIED_DATABASE_BASE58_ORDER].map((character, rank) => [
    character,
    rank
  ])
);

// Keep the fake's database model independent from the production pagination code.
// The fallback keeps non-Base58 fixture text on its existing locale-aware path.
function compareDatabaseIds(left: string, right: string): number {
  if (left === right) return 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftCharacter = left[index];
    const rightCharacter = right[index];
    if (leftCharacter === rightCharacter) continue;
    const leftRank = databaseBase58Ranks.get(leftCharacter);
    const rightRank = databaseBase58Ranks.get(rightCharacter);
    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  }
  return left.length - right.length;
}

type FakeClientOptions = {
  rows: Record<string, FakeRow[]>;
  errors?: Set<string>;
  queries?: string[];
  selects?: string[];
  inCalls?: Array<{
    table: string;
    column: string;
    values: unknown[];
  }>;
  maxRows?: number;
};

function fakeImpactClient(options: FakeClientOptions) {
  const queries = options.queries ?? [];
  const selects = options.selects ?? [];
  const inCalls = options.inCalls ?? [];
  const errors = options.errors ?? new Set<string>();
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;

  return {
    queries,
    selects,
    inCalls,
    from(table: string) {
      queries.push(table);
      const state: {
        select: string;
        count: boolean;
        head: boolean;
        eq: Array<[string, unknown]>;
        in: Array<[string, unknown[]]>;
        gt: Array<[string, unknown]>;
        is: Array<[string, unknown]>;
        order: Array<{ column: string; ascending: boolean }>;
        range: [number, number] | null;
        limit: number | null;
        single: boolean;
      } = {
        select: "*",
        count: false,
        head: false,
        eq: [],
        in: [],
        gt: [],
        is: [],
        order: [],
        range: null,
        limit: null,
        single: false
      };

      const relatedValue = (row: FakeRow, column: string): unknown => {
        if (
          column === "purchaseOrder.status" ||
          column === "purchaseOrder.companyId"
        ) {
          const parent = options.rows.purchaseOrder?.find(
            (candidate) => candidate.id === row.purchaseOrderId
          );
          return column.endsWith("status")
            ? (parent?.status ?? row.purchaseOrderStatus)
            : (parent?.companyId ?? row.purchaseOrderCompanyId);
        }
        if (column === "job.status" || column === "job.companyId") {
          const parent = options.rows.job?.find(
            (candidate) => candidate.id === row.jobId
          );
          return column.endsWith("status")
            ? (parent?.status ?? row.jobStatus)
            : (parent?.companyId ?? row.jobCompanyId);
        }
        return row[column];
      };

      const hasParent = (row: FakeRow, relation: "purchaseOrder" | "job") =>
        relation === "purchaseOrder"
          ? options.rows.purchaseOrder?.some(
              (parent) => parent.id === row.purchaseOrderId
            )
          : options.rows.job?.some((parent) => parent.id === row.jobId);

      const builder = {
        select: (
          columns?: string,
          selectOptions?: { count?: string; head?: boolean }
        ) => {
          state.select = columns ?? "*";
          selects.push(state.select);
          state.count = selectOptions?.count === "exact";
          state.head = selectOptions?.head === true;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          state.eq.push([column, value]);
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          state.in.push([column, values]);
          inCalls.push({ table, column, values: [...values] });
          return builder;
        },
        gt: (column: string, value: unknown) => {
          state.gt.push([column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          state.is.push([column, value]);
          return builder;
        },
        order: (column: string, orderOptions?: { ascending?: boolean }) => {
          state.order.push({
            column,
            ascending: orderOptions?.ascending !== false
          });
          return builder;
        },
        range: (from: number, to: number) => {
          state.range = [from, to];
          return builder;
        },
        limit: (value: number) => {
          state.limit = value;
          return builder;
        },
        single: () => {
          state.single = true;
          return Promise.resolve(resolve());
        },
        maybeSingle: () => {
          state.single = true;
          return Promise.resolve(resolve(true));
        },
        then: (
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => Promise.resolve(resolve()).then(onFulfilled, onRejected)
      };

      function resolve(allowEmpty = false) {
        if (
          errors.has(table) ||
          (state.count && errors.has(`${table}:count`))
        ) {
          return {
            data: null,
            count: null,
            error: { message: `${table} failed` }
          };
        }
        let result = [...(options.rows[table] ?? [])];
        if (state.select.includes("purchaseOrder!inner")) {
          result = result.filter((row) => hasParent(row, "purchaseOrder"));
        }
        if (state.select.includes("job!inner")) {
          result = result.filter((row) => hasParent(row, "job"));
        }
        for (const [column, value] of state.eq) {
          result = result.filter((row) => relatedValue(row, column) === value);
        }
        for (const [column, values] of state.in) {
          result = result.filter((row) =>
            values.includes(relatedValue(row, column))
          );
        }
        for (const [column, value] of state.gt) {
          result = result.filter((row) => {
            const actual = relatedValue(row, column);
            if (typeof actual === "number" && typeof value === "number") {
              return actual > value;
            }
            return (
              typeof actual === "string" &&
              typeof value === "string" &&
              compareDatabaseIds(actual, value) > 0
            );
          });
        }
        for (const [column, value] of state.is) {
          result = result.filter((row) =>
            value === null
              ? relatedValue(row, column) === null
              : relatedValue(row, column) === value
          );
        }
        if (state.order.length > 0) {
          result.sort((left, right) => {
            for (const { column, ascending } of state.order) {
              const leftValue = relatedValue(left, column);
              const rightValue = relatedValue(right, column);
              if (leftValue === rightValue) continue;
              const comparison = compareDatabaseIds(
                String(leftValue),
                String(rightValue)
              );
              return ascending ? comparison : -comparison;
            }
            return 0;
          });
        }
        const count = result.length;
        if (state.limit !== null) result = result.slice(0, state.limit);
        if (state.range !== null) {
          const [from, to] = state.range;
          result = result.slice(from, to + 1);
        }
        if (Number.isFinite(maxRows)) result = result.slice(0, maxRows);
        if (state.head) return { data: null, count, error: null };

        const projected =
          state.select === "*"
            ? result
            : result.map((row) => {
                const columns = state.select
                  .split(",")
                  .map((column) => column.trim())
                  .filter(
                    (column) => column.length > 0 && !column.includes("!")
                  );
                return Object.fromEntries(
                  columns
                    .filter((column) => Object.hasOwn(row, column))
                    .map((column) => [column, row[column]])
                );
              });
        if (state.single) {
          return {
            data: projected[0] ?? null,
            count: state.count ? count : null,
            error:
              projected.length === 0 && !allowEmpty
                ? { message: `${table} not found` }
                : null
          };
        }
        return {
          data: projected,
          count: state.count ? count : null,
          error: null
        };
      }

      return builder;
    }
  } as unknown as SupabaseClient<Database> & {
    queries: string[];
    selects: string[];
    inCalls: Array<{ table: string; column: string; values: unknown[] }>;
  };
}

function baseImpactRows(over: Partial<FakeClientOptions["rows"]> = {}) {
  const affected = [
    {
      id: "affected-1",
      changeOrderId: changeNoticeId,
      itemId: "item-1",
      companyId,
      item: {
        id: "item-1",
        readableId: "PART-1",
        readableIdWithRevision: "PART-1.A",
        name: "Part 1",
        revision: "A"
      }
    }
  ];
  const items = [
    {
      id: "item-1",
      readableId: "PART-1",
      readableIdWithRevision: "PART-1.A",
      revision: "A",
      unitOfMeasureCode: "EA",
      companyId
    }
  ];
  const rows: Record<string, FakeRow[]> = {
    changeOrder: [
      {
        id: changeNoticeId,
        companyId,
        status: "Draft",
        changeOrderId: "CN-1",
        name: "Change"
      }
    ],
    changeOrderAffectedItem: affected,
    item: items,
    purchaseOrderLine: [],
    purchaseOrder: [],
    purchaseOrderDelivery: [],
    job: [],
    jobMakeMethod: [],
    jobMaterial: [],
    changeOrderImpactDecision: [],
    changeOrderImpactDecisionAffectedItem: [],
    ...over
  };
  if (!("purchaseOrderDelivery" in over)) {
    rows.purchaseOrderDelivery = (rows.purchaseOrder ?? []).map((parent) => ({
      id: parent.id,
      receiptPromisedDate: null,
      companyId
    }));
  }
  return rows;
}

function poRow(id: string, itemId = "item-1", over: FakeRow = {}) {
  return {
    id,
    purchaseOrderId: `po-${id}`,
    supplierId: "supplier-1",
    itemId,
    itemRevision: "A",
    purchaseOrderLineType: "Part",
    purchaseOrderStatus: "To Receive",
    purchaseQuantity: 10,
    quantityReceived: 2,
    quantityToReceive: 8,
    receivedComplete: false,
    purchaseUnitOfMeasureCode: "EA",
    inventoryUnitOfMeasureCode: "EA",
    conversionFactor: 1,
    requiredDate: "2026-08-25",
    promisedDate: null,
    deliveryRowPresent: true,
    deliveryReceiptPromisedDate: null,
    companyId,
    ...over
  };
}

function poParent(id: string, status = "To Receive") {
  return {
    id,
    purchaseOrderId: id.toUpperCase(),
    supplierId: "supplier-1",
    status,
    companyId
  };
}

function jobRow(id: string, itemId = "item-1", status = "In Progress") {
  return {
    id,
    jobId: id.toUpperCase(),
    itemId,
    status,
    quantity: 100,
    productionQuantity: 100,
    quantityComplete: 20,
    quantityShipped: 10,
    quantityReceivedToInventory: 5,
    dueDate: "2026-08-30",
    unitOfMeasureCode: "EA",
    companyId
  };
}

function rootRow(jobId: string, itemId = "item-1") {
  return {
    id: `root-${jobId}`,
    jobId,
    itemId,
    version: 2,
    parentMaterialId: null,
    companyId
  };
}

function materialRow(id: string, jobId: string, itemId = "item-1") {
  return {
    id,
    jobId,
    itemId,
    estimatedQuantity: 5,
    quantityIssued: 5,
    quantityToIssue: 0,
    unitOfMeasureCode: "EA",
    methodType: "Pull from Inventory",
    jobOperationId: null,
    requiresBatchTracking: true,
    requiresSerialTracking: false,
    companyId
  };
}

function largeAffectedItemRows(count = 1001) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(4, "0");
    return {
      id: `affected-${suffix}`,
      changeOrderId: changeNoticeId,
      itemId: `item-${suffix}`,
      sortOrder: suffix,
      createdAt: "2026-08-24T00:00:00Z",
      companyId
    };
  });
}

function largeItemRows(count = 1001) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(4, "0");
    return {
      id: `item-${suffix}`,
      readableId: `PART-${suffix}`,
      readableIdWithRevision: `PART-${suffix}.A`,
      name: `Part ${suffix}`,
      type: "Part",
      active: true,
      revisionStatus: "Draft",
      replenishmentSystem: "Make",
      revision: "A",
      unitOfMeasureCode: "EA",
      companyId
    };
  });
}

describe("Change Notice affected-item scope", () => {
  it("loads affected items and labels beyond the PostgREST row cap", async () => {
    const client = fakeImpactClient({
      maxRows: 1000,
      rows: baseImpactRows({
        changeOrderAffectedItem: largeAffectedItemRows(),
        item: largeItemRows()
      })
    });

    const result = await getChangeNoticeAffectedItems(
      client,
      changeNoticeId,
      companyId
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1001);
    expect(result.data.at(-1)).toMatchObject({
      id: "affected-1000",
      item: { id: "item-1000", readableIdWithRevision: "PART-1000.A" }
    });
    expect(
      client.inCalls
        .filter((call) => call.table === "item")
        .every((call) => call.values.length <= 50)
    ).toBe(true);
  });
});

describe("Change Notice Impact candidate discovery", () => {
  it("discovers PO, Job, and Job Material set-wise and preserves an active fully-issued material", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-1")],
      purchaseOrder: [poParent("po-pol-1")],
      purchaseOrderDelivery: [
        { id: "po-pol-1", receiptPromisedDate: "2026-08-31", companyId }
      ],
      job: [jobRow("job-1")],
      jobMakeMethod: [rootRow("job-1")],
      jobMaterial: [materialRow("material-1", "job-1")]
    });
    const client = fakeImpactClient({ rows });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.error).toBeNull();
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("complete");
    expect(result.data?.coverage.job.status).toBe("complete");
    expect(result.data?.coverage.jobMaterial.status).toBe("complete");
    expect(result.data?.coverage.job.currentExposureCount).toBe(1);
    expect(result.data?.coverage.jobMaterial.currentExposureCount).toBe(1);
    expect(result.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(
      1
    );
    expect(
      result.data?.candidates.map((candidate) => candidate.targetType)
    ).toEqual(["job", "jobMaterial", "purchaseOrderLine"]);
    const material = result.data?.candidates.find(
      (candidate) => candidate.targetType === "jobMaterial"
    );
    expect(material?.exposureClassification).toBe(
      "Current operational exposure"
    );
    expect(material?.currentSnapshot).toMatchObject({
      issuedQuantity: 5,
      remainingQuantity: 0
    });
    expect(
      client.queries.filter((table) => table === "job").length
    ).toBeLessThanOrEqual(3);
    expect(
      client.queries.filter((table) => table === "jobMaterial").length
    ).toBeLessThanOrEqual(3);
    expect(
      client.queries.filter((table) => table === "purchaseOrderLine").length
    ).toBeLessThanOrEqual(3);
    expect(client.queries).not.toContain("jobMaterialUsage");
    expect(
      client.selects
        .filter((select) => select.includes("quantityComplete"))
        .every((select) => !select.includes("productionQuantity"))
    ).toBe(true);
  });

  it("keeps valid candidates when one domain row has a negative quantity", async () => {
    const cases = [
      {
        targetType: "purchaseOrderLine" as const,
        validId: "pol-valid",
        invalidId: "pol-negative",
        rows: {
          purchaseOrderLine: [
            poRow("pol-valid"),
            poRow("pol-negative", "item-1", { purchaseQuantity: -1 })
          ],
          purchaseOrder: [poParent("po-pol-valid"), poParent("po-pol-negative")]
        }
      },
      {
        targetType: "job" as const,
        validId: "job-valid",
        invalidId: "job-negative",
        rows: {
          job: [
            jobRow("job-valid"),
            { ...jobRow("job-negative"), quantity: -1 }
          ],
          jobMakeMethod: [rootRow("job-valid"), rootRow("job-negative")]
        }
      },
      {
        targetType: "jobMaterial" as const,
        validId: "material-valid",
        invalidId: "material-negative",
        rows: {
          job: [jobRow("job-material-parent")],
          jobMakeMethod: [rootRow("job-material-parent")],
          jobMaterial: [
            materialRow("material-valid", "job-material-parent"),
            {
              ...materialRow("material-negative", "job-material-parent"),
              quantityIssued: -1
            }
          ]
        }
      }
    ];

    for (const entry of cases) {
      const result = await getChangeNoticeImpactCandidates(
        fakeImpactClient({ rows: baseImpactRows(entry.rows) }),
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      expect(
        result.data?.candidates.find(
          (candidate) => candidate.targetId === entry.invalidId
        )
      ).toMatchObject({
        sourceAvailability: "Unavailable",
        exposureClassification: null
      });
      expect(
        result.data?.candidates.find(
          (candidate) => candidate.targetId === entry.validId
        )
      ).toMatchObject({
        sourceAvailability: "Present",
        exposureClassification: "Current operational exposure"
      });
      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "partial",
        currentExposureCount: null,
        historicalReferenceCount: null
      });
    }
  });

  it("marks a producing Job unavailable when its required root method is missing", async () => {
    const rows = baseImpactRows({
      job: [jobRow("job-without-root")],
      jobMakeMethod: []
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetType === "job"
    );
    expect(candidate?.sourceAvailability).toBe("Unavailable");
    expect(result.data?.coverage.job.currentExposureCount).toBeNull();
  });

  it("recovers a hidden duplicate root method past the PostgREST row cap", async () => {
    const otherJobIds = Array.from(
      { length: 49 },
      (_, index) => `job-other-${index.toString().padStart(2, "0")}`
    );
    const jobs = ["job-target", ...otherJobIds].map((id) => jobRow(id));
    const rootMethods = [
      { ...rootRow("job-target"), id: "root-job-target-1" },
      ...Array.from({ length: 999 }, (_, index) => {
        const jobId = otherJobIds[index % otherJobIds.length];
        return { ...rootRow(jobId), id: `root-${jobId}-${index}` };
      }),
      { ...rootRow("job-target"), id: "root-job-target-2" }
    ];
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        maxRows: 1000,
        rows: baseImpactRows({ job: jobs, jobMakeMethod: rootMethods })
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const target = result.data?.candidates.find(
      (candidate) =>
        candidate.targetType === "job" && candidate.targetId === "job-target"
    );
    expect(target).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      currentSnapshot: null
    });
    expect(result.data?.coverage.job.status).toBe("partial");
  });

  it("marks a Job unavailable when its root method belongs to another item", async () => {
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-b",
          changeOrderId: changeNoticeId,
          itemId: "item-b",
          companyId
        },
        {
          id: "affected-c",
          changeOrderId: changeNoticeId,
          itemId: "item-c",
          companyId
        }
      ],
      item: [
        {
          id: "item-b",
          readableId: "PART-B",
          readableIdWithRevision: "PART-B.A",
          revision: "A",
          unitOfMeasureCode: "EA",
          companyId
        },
        {
          id: "item-c",
          readableId: "PART-C",
          readableIdWithRevision: "PART-C.A",
          revision: "A",
          unitOfMeasureCode: "EA",
          companyId
        }
      ],
      job: [jobRow("job-mismatch", "item-b"), jobRow("job-valid", "item-c")],
      jobMakeMethod: [
        rootRow("job-mismatch", "item-a"),
        rootRow("job-valid", "item-c")
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );

    const mismatch = result.data?.candidates.find(
      (candidate) => candidate.targetId === "job-mismatch"
    );
    const valid = result.data?.candidates.find(
      (candidate) => candidate.targetId === "job-valid"
    );
    expect(mismatch).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      parent: null,
      item: null,
      currentSnapshot: null
    });
    expect(mismatch?.sourceAvailability).not.toBe("Source deleted");
    expect(valid).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    expect(result.data?.coverage.job).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
  });

  it("uses bounded set reads for many lines rather than querying once per affected item", async () => {
    const itemIds = Array.from(
      { length: 5 },
      (_, index) => `item-${index + 1}`
    );
    const affectedItems = itemIds.map((itemId, index) => ({
      id: `affected-${index + 1}`,
      changeOrderId: changeNoticeId,
      itemId,
      companyId,
      item: {
        id: itemId,
        readableId: `PART-${index + 1}`,
        readableIdWithRevision: `PART-${index + 1}.A`,
        name: `Part ${index + 1}`,
        revision: "A"
      }
    }));
    const items = itemIds.map((itemId, index) => ({
      id: itemId,
      readableId: `PART-${index + 1}`,
      readableIdWithRevision: `PART-${index + 1}.A`,
      revision: "A",
      unitOfMeasureCode: "EA",
      companyId
    }));
    const purchaseOrderLines = itemIds.map((itemId, index) =>
      poRow(`pol-${index + 1}`, itemId)
    );
    const purchaseOrders = purchaseOrderLines.map((line) =>
      poParent(line.purchaseOrderId as string)
    );
    const client = fakeImpactClient({
      rows: baseImpactRows({
        changeOrderAffectedItem: affectedItems,
        item: items,
        purchaseOrderLine: purchaseOrderLines,
        purchaseOrder: purchaseOrders
      })
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.error).toBeNull();
    expect(
      client.queries.filter((table) => table === "purchaseOrderLine").length
    ).toBeLessThanOrEqual(3);
    expect(
      result.data?.candidates.filter(
        (candidate) => candidate.targetType === "purchaseOrderLine"
      )
    ).toHaveLength(5);
  });

  it("keeps Impact PostgREST ID filters within Carbon's safe batch size", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({
        changeOrderAffectedItem: largeAffectedItemRows(),
        item: largeItemRows()
      })
    });

    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );

    expect(result.error).toBeNull();
    expect(client.inCalls.length).toBeGreaterThan(0);
    expect(client.inCalls.every((call) => call.values.length <= 50)).toBe(true);
    expect(Math.max(...client.inCalls.map((call) => call.values.length))).toBe(
      50
    );
  });

  it("excludes a tiny positive PO quantity that rounds to zero from current exact counts", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [
        poRow("pol-tiny", "item-1", { quantityToReceive: 0.0000001 })
      ],
      purchaseOrder: [poParent("po-pol-tiny")]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(
      0
    );
    expect(
      result.data?.coverage.purchaseOrderLine.historicalReferenceCount
    ).toBe(1);
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-tiny"
      )?.exposureClassification
    ).toBe("Historical reference");
  });

  it("fails closed when a tiny positive conversion factor rounds to zero", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [
        poRow("pol-tiny-factor", "item-1", {
          quantityToReceive: 100000,
          conversionFactor: 0.000001
        }),
        poRow("pol-valid-factor")
      ],
      purchaseOrder: [
        poParent("po-pol-tiny-factor"),
        poParent("po-pol-valid-factor")
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const tiny = result.data?.candidates.find(
      (candidate) => candidate.targetId === "pol-tiny-factor"
    );
    const valid = result.data?.candidates.find(
      (candidate) => candidate.targetId === "pol-valid-factor"
    );

    expect(tiny).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      currentSnapshot: null
    });
    expect(tiny?.exposureClassification).not.toBe("Historical reference");
    expect(valid).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
  });

  it("fails exact PO counts when off-page semantic facts are missing or invalid", async () => {
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-1",
          changeOrderId: changeNoticeId,
          itemId: "item-1",
          companyId,
          item: {
            id: "item-1",
            readableId: "PART-1",
            readableIdWithRevision: "PART-1.A",
            name: "Part 1",
            revision: "A"
          }
        },
        {
          id: "affected-2",
          changeOrderId: changeNoticeId,
          itemId: "item-2",
          companyId,
          item: {
            id: "item-2",
            readableId: "PART-2",
            readableIdWithRevision: "PART-2.A",
            name: "Part 2",
            revision: "A"
          }
        }
      ],
      purchaseOrderLine: [
        poRow("pol-valid"),
        poRow("pol-invalid", "item-2", { conversionFactor: 0 }),
        poRow("pol-missing-uom", "item-2", {
          purchaseUnitOfMeasureCode: undefined
        }),
        poRow("pol-unknown-type", "item-1", {
          purchaseOrderLineType: "Future line type"
        })
      ],
      purchaseOrder: [
        poParent("po-pol-valid"),
        poParent("po-pol-invalid"),
        poParent("po-pol-missing-uom"),
        poParent("po-pol-unknown-type")
      ],
      purchaseOrderDelivery: [
        { id: "po-pol-valid", receiptPromisedDate: null, companyId },
        { id: "po-pol-invalid", receiptPromisedDate: null, companyId },
        { id: "po-pol-missing-uom", receiptPromisedDate: null, companyId },
        { id: "po-pol-unknown-type", receiptPromisedDate: null, companyId }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-valid"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-invalid"
      )
    ).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null
    });
  });

  it("does not omit an unknown PO line type from semantic coverage", async () => {
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          purchaseOrderLine: [
            poRow("pol-unknown-type", "item-1", {
              purchaseOrderLineType: "Future line type"
            })
          ],
          purchaseOrder: [poParent("po-pol-unknown-type")],
          purchaseOrderDelivery: [
            { id: "po-pol-unknown-type", receiptPromisedDate: null, companyId }
          ]
        })
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-unknown-type"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
  });

  it("does not count an off-page persisted PO with missing source facts", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("stored"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          purchaseOrderLine: [poRow("persisted-invalid", "item-2")],
          purchaseOrder: [poParent("po-persisted-invalid")],
          purchaseOrderDelivery: [
            {
              id: "po-persisted-invalid",
              receiptPromisedDate: null,
              companyId
            }
          ],
          changeOrderImpactDecision: [
            {
              id: "decision-deleted",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "aaa-deleted",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: stored.snapshot
            },
            {
              id: "decision-invalid",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "persisted-invalid",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: stored.snapshot
            }
          ]
        })
      }),
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "aaa-deleted"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "aaa-deleted"
      )?.sourceAvailability
    ).not.toBe("Source deleted");
  });

  it("does not count off-page Jobs missing an item or unique root method", async () => {
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-1",
          changeOrderId: changeNoticeId,
          itemId: "item-1",
          companyId,
          item: {
            id: "item-1",
            readableId: "PART-1",
            readableIdWithRevision: "PART-1.A",
            name: "Part 1",
            revision: "A"
          }
        },
        {
          id: "affected-2",
          changeOrderId: changeNoticeId,
          itemId: "item-2",
          companyId,
          item: {
            id: "item-2",
            readableId: "PART-2",
            readableIdWithRevision: "PART-2.A",
            name: "Part 2",
            revision: "A"
          }
        }
      ],
      job: [
        jobRow("job-valid"),
        jobRow("job-missing-item", "item-2"),
        jobRow("job-invalid")
      ],
      jobMakeMethod: [
        rootRow("job-valid"),
        rootRow("job-missing-item"),
        rootRow("job-invalid"),
        rootRow("job-invalid")
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.job).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-valid"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-missing-item"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-invalid"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
  });

  it("does not count off-page Job Materials missing parent, item, or material facts", async () => {
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-1",
          changeOrderId: changeNoticeId,
          itemId: "item-1",
          companyId,
          item: {
            id: "item-1",
            readableId: "PART-1",
            readableIdWithRevision: "PART-1.A",
            name: "Part 1",
            revision: "A"
          }
        },
        {
          id: "affected-2",
          changeOrderId: changeNoticeId,
          itemId: "item-2",
          companyId,
          item: {
            id: "item-2",
            readableId: "PART-2",
            readableIdWithRevision: "PART-2.A",
            name: "Part 2",
            revision: "A"
          }
        }
      ],
      job: [jobRow("job-valid")],
      jobMakeMethod: [rootRow("job-valid")],
      jobMaterial: [
        materialRow("material-valid", "job-valid"),
        materialRow("material-missing-item", "job-valid", "item-2"),
        materialRow("material-invalid-parent", "job-missing", "item-1"),
        {
          ...materialRow("material-invalid-facts", "job-valid", "item-1"),
          methodType: undefined
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.jobMaterial).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "material-valid"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    for (const targetId of [
      "material-missing-item",
      "material-invalid-parent",
      "material-invalid-facts"
    ]) {
      expect(
        result.data?.candidates.find(
          (candidate) => candidate.targetId === targetId
        )
      ).toMatchObject({ sourceAvailability: "Unavailable" });
    }
  });

  it("pages current and historical PO streams independently with historical rows outside current counts", async () => {
    const lines = [
      poRow("hist-a"),
      poRow("hist-b"),
      poRow("curr-a"),
      poRow("curr-b")
    ];
    const rows = baseImpactRows({
      purchaseOrderLine: lines,
      purchaseOrder: [
        poParent("po-hist-a", "Completed"),
        poParent("po-hist-b", "Completed"),
        poParent("po-curr-a"),
        poParent("po-curr-b")
      ]
    });
    const client = fakeImpactClient({ rows });
    const first = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 2
      }
    );
    expect(
      first.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-a", "curr-b"]);
    expect(
      first.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-a", "hist-b"]);
    expect(first.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(2);
    expect(
      first.data?.coverage.purchaseOrderLine.historicalReferenceCount
    ).toBe(2);
    expect(first.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: null
    });

    const historical = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 2,
        cursor: { purchaseOrderLine: { historical: "hist-a" } }
      }
    );
    expect(
      historical.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-b"]);
    expect(
      historical.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-a", "curr-b"]);
    expect(historical.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: null
    });

    const currentAfterHistorical = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "curr-a" } }
      }
    );
    expect(
      currentAfterHistorical.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-b"]);
    expect(
      currentAfterHistorical.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-a"]);
    expect(
      currentAfterHistorical.data?.coverage.purchaseOrderLine.nextCursor
    ).toEqual({ current: null, historical: "hist-a" });
  });

  it("traverses current and historical streams independently without duplicates", async () => {
    const lines = [
      poRow("hist-a"),
      poRow("hist-b"),
      poRow("hist-c"),
      poRow("curr-a"),
      poRow("curr-b"),
      poRow("curr-c")
    ];
    const rows = baseImpactRows({
      purchaseOrderLine: lines,
      purchaseOrder: [
        poParent("po-hist-a", "Completed"),
        poParent("po-hist-b", "Completed"),
        poParent("po-hist-c", "Completed"),
        poParent("po-curr-a"),
        poParent("po-curr-b"),
        poParent("po-curr-c")
      ]
    });
    const client = fakeImpactClient({ rows });
    const seenCurrent = new Set<string>();
    const seenHistorical = new Set<string>();
    let cursor:
      | {
          purchaseOrderLine: {
            current: string | null;
            historical: string | null;
          };
        }
      | undefined;

    for (let index = 0; index < 3; index += 1) {
      const result = await getChangeNoticeImpactCandidates(
        client,
        companyId,
        changeNoticeId,
        { sourceAccess, limit: 1, ...(cursor ? { cursor } : {}) }
      );
      const purchaseCandidates = result.data?.candidates.filter(
        (candidate) => candidate.targetType === "purchaseOrderLine"
      );
      const current = purchaseCandidates?.find(
        (candidate) =>
          candidate.exposureClassification === "Current operational exposure"
      );
      const historical = purchaseCandidates?.find(
        (candidate) =>
          candidate.exposureClassification === "Historical reference"
      );
      expect(current?.targetId).toBe(`curr-${String.fromCharCode(97 + index)}`);
      expect(historical?.targetId).toBe(
        `hist-${String.fromCharCode(97 + index)}`
      );
      expect(seenCurrent.has(current?.targetId ?? "")).toBe(false);
      expect(seenHistorical.has(historical?.targetId ?? "")).toBe(false);
      seenCurrent.add(current?.targetId ?? "");
      seenHistorical.add(historical?.targetId ?? "");
      cursor = {
        purchaseOrderLine: result.data?.coverage.purchaseOrderLine
          .nextCursor ?? {
          current: null,
          historical: null
        }
      };
    }

    expect(seenCurrent).toEqual(new Set(["curr-a", "curr-b", "curr-c"]));
    expect(seenHistorical).toEqual(new Set(["hist-a", "hist-b", "hist-c"]));
    expect(cursor?.purchaseOrderLine).toEqual({
      current: null,
      historical: null
    });

    const historicalOnly = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { historical: "hist-a" } }
      }
    );
    expect(
      historicalOnly.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-a"]);
    expect(
      historicalOnly.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-b"]);

    const currentOnly = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "curr-a" } }
      }
    );
    expect(
      currentOnly.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Current operational exposure"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["curr-b"]);
    expect(
      currentOnly.data?.candidates
        .filter(
          (candidate) =>
            candidate.targetType === "purchaseOrderLine" &&
            candidate.exposureClassification === "Historical reference"
        )
        .map((candidate) => candidate.targetId)
    ).toEqual(["hist-a"]);
  });

  it("fails exact Job counts when an off-page status is unknown", async () => {
    const rows = baseImpactRows({
      job: [jobRow("job-valid"), jobRow("job-unknown", "item-1", "Overdue")],
      jobMakeMethod: [rootRow("job-valid"), rootRow("job-unknown")]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.job).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-valid"
      )
    ).toMatchObject({ sourceAvailability: "Present" });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "job-unknown"
      )
    ).toMatchObject({ sourceAvailability: "Unavailable" });
  });

  it("paginates with stable ordering, real cursors, and exact summary counts independent of the visible page", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-b"), poRow("pol-a"), poRow("pol-c")],
      purchaseOrder: [
        poParent("po-pol-b"),
        poParent("po-pol-a"),
        poParent("po-pol-c")
      ]
    });
    const client = fakeImpactClient({ rows });

    const first = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    expect(
      first.data?.candidates
        .filter((candidate) => candidate.targetType === "purchaseOrderLine")
        .map((candidate) => candidate.targetId)
    ).toEqual(["pol-a"]);
    expect(first.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: "pol-a",
      historical: null
    });
    expect(first.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(3);
    expect(first.data?.coverage.purchaseOrderLine.unassessedCount).toBeNull();

    const second = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "pol-a" } }
      }
    );
    expect(
      second.data?.candidates
        .filter((candidate) => candidate.targetType === "purchaseOrderLine")
        .map((candidate) => candidate.targetId)
    ).toEqual(["pol-b"]);
    expect(second.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: "pol-b",
      historical: null
    });

    const third = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "pol-b" } }
      }
    );
    expect(
      third.data?.candidates
        .filter((candidate) => candidate.targetType === "purchaseOrderLine")
        .map((candidate) => candidate.targetId)
    ).toEqual(["pol-c"]);
    expect(third.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: null
    });
    expect(third.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(3);
  });

  it("does not skip or repeat mixed-case IDs across failed-coverage continuation pages", async () => {
    const lines = [
      poRow("pol_A"),
      poRow("pol_B"),
      poRow("pol_a"),
      poRow("pol_b")
    ];
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: lines,
        purchaseOrder: lines.map((line) =>
          poParent(line.purchaseOrderId as string)
        )
      }),
      errors: new Set(["purchaseOrderLine:count"])
    });
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let index = 0; index < lines.length; index += 1) {
      const result = await getChangeNoticeImpactCandidates(
        client,
        companyId,
        changeNoticeId,
        {
          sourceAccess,
          limit: 1,
          ...(cursor
            ? { cursor: { purchaseOrderLine: { current: cursor } } }
            : {})
        }
      );
      const candidate = result.data?.candidates.find(
        (entry) => entry.targetType === "purchaseOrderLine"
      );
      expect(candidate).toBeDefined();
      seen.push(candidate?.targetId ?? "");
      const nextCursor =
        result.data?.coverage.purchaseOrderLine.nextCursor.current;
      if (nextCursor === null) break;
      cursor = nextCursor;
    }

    expect(seen).toEqual(["pol_a", "pol_A", "pol_b", "pol_B"]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("reports a failed summary/count query without exposing fake exact totals", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-count-failure")],
      purchaseOrder: [poParent("po-pol-count-failure")]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows,
        errors: new Set(["purchaseOrderLine:count"])
      }),
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "failed",
      currentExposureCount: null,
      historicalReferenceCount: null,
      unassessedCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-count-failure"
      )
    ).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      currentSnapshot: null
    });
  });

  it("preserves a valid persisted decision beside an unrelated malformed row", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-a"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      changeOrderAffectedItem: [
        {
          id: "affected-1",
          changeOrderId: changeNoticeId,
          itemId: "item-1",
          companyId,
          item: {
            id: "item-1",
            readableId: "PART-1",
            readableIdWithRevision: "PART-1.A",
            name: "Part 1",
            revision: "A"
          }
        },
        {
          id: "affected-2",
          changeOrderId: changeNoticeId,
          itemId: "item-2",
          companyId,
          item: {
            id: "item-2",
            readableId: "PART-2",
            readableIdWithRevision: "PART-2.A",
            name: "Part 2",
            revision: "A"
          }
        }
      ],
      purchaseOrderLine: [
        poRow("pol-a"),
        poRow("pol-z", "item-2", { purchaseUnitOfMeasureCode: undefined })
      ],
      purchaseOrder: [poParent("po-pol-a"), poParent("po-pol-z")],
      purchaseOrderDelivery: [
        { id: "po-pol-a", receiptPromisedDate: null, companyId },
        { id: "po-pol-z", receiptPromisedDate: null, companyId }
      ],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-a",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-a",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-a"
    );
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("partial");
    expect(candidate).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure",
      decision: { status: "Action required" },
      freshness: "Current"
    });
  });

  it("marks a visible malformed persisted snapshot as partial without poisoning valid rows", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-bad"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-good"), poRow("pol-bad")],
      purchaseOrder: [poParent("po-pol-good"), poParent("po-pol-bad")],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-bad",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-bad",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: {
            ...stored.snapshot,
            orderedQuantity: 10.000001
          }
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-good"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      exposureClassification: "Current operational exposure"
    });
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-bad"
      )
    ).toMatchObject({
      sourceAvailability: "Unavailable",
      freshness: "Unknown"
    });
  });

  it("keeps off-page malformed persisted snapshots in domain coverage", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-z"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-a"), poRow("pol-z")],
      purchaseOrder: [poParent("po-pol-a"), poParent("po-pol-z")],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-z",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-z",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: {
            ...stored.snapshot,
            orderedQuantity: 10.000001
          }
        }
      ]
    });
    const client = fakeImpactClient({ rows });
    const first = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    expect(
      first.data?.candidates.some((candidate) => candidate.targetId === "pol-z")
    ).toBe(false);
    expect(first.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });

    const second = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 1,
        cursor: { purchaseOrderLine: { current: "pol-a" } }
      }
    );
    expect(
      second.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-z"
      )
    ).toMatchObject({
      sourceAvailability: "Unavailable",
      freshness: "Unknown"
    });
    expect(
      second.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-z"
      )?.sourceAvailability
    ).not.toBe("Source deleted");
    expect(second.data?.coverage.purchaseOrderLine.status).toBe("partial");
  });

  it("does not infer Source deleted when malformed persisted evidence makes a domain partial", async () => {
    const poMissingSnapshot = normalizePurchaseOrderLineImpactSnapshot(
      poRow("pol-missing")
    );
    const poMalformedSnapshot = normalizePurchaseOrderLineImpactSnapshot(
      poRow("pol-malformed")
    );
    const jobMissingSnapshot = normalizeJobImpactSnapshot({
      ...jobRow("job-missing"),
      jobId: "job-missing",
      itemRevision: "A",
      effectiveMethodId: "job-method-missing",
      effectiveMethodVersion: 2
    });
    const jobMalformedSnapshot = normalizeJobImpactSnapshot({
      ...jobRow("job-malformed"),
      jobId: "job-malformed",
      itemRevision: "A",
      effectiveMethodId: "job-method-malformed",
      effectiveMethodVersion: 2
    });
    const materialMissingSnapshot = normalizeJobMaterialImpactSnapshot({
      ...materialRow("material-missing", "job-material-parent"),
      itemRevision: "A",
      jobStatus: "In Progress"
    });
    const materialMalformedSnapshot = normalizeJobMaterialImpactSnapshot({
      ...materialRow("material-malformed", "job-material-parent"),
      itemRevision: "A",
      jobStatus: "In Progress"
    });
    if (
      poMissingSnapshot.sourceAvailability !== "Present" ||
      poMalformedSnapshot.sourceAvailability !== "Present" ||
      jobMissingSnapshot.sourceAvailability !== "Present" ||
      jobMalformedSnapshot.sourceAvailability !== "Present" ||
      materialMissingSnapshot.sourceAvailability !== "Present" ||
      materialMalformedSnapshot.sourceAvailability !== "Present"
    ) {
      throw new Error("Impact regression fixtures must normalize successfully");
    }

    const cases = [
      {
        targetType: "purchaseOrderLine" as const,
        missingId: "pol-missing",
        malformedId: "pol-malformed",
        rows: baseImpactRows({
          purchaseOrderLine: [poRow("pol-malformed")],
          purchaseOrder: [poParent("po-pol-malformed")],
          changeOrderImpactDecision: [
            {
              id: "decision-pol-missing",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "pol-missing",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: poMissingSnapshot.snapshot
            },
            {
              id: "decision-pol-malformed",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "pol-malformed",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: {
                ...poMalformedSnapshot.snapshot,
                orderedQuantity: 10.000001
              }
            }
          ]
        })
      },
      {
        targetType: "job" as const,
        missingId: "job-missing",
        malformedId: "job-malformed",
        rows: baseImpactRows({
          job: [jobRow("job-malformed")],
          jobMakeMethod: [rootRow("job-malformed")],
          changeOrderImpactDecision: [
            {
              id: "decision-job-missing",
              companyId,
              changeNoticeId,
              targetType: "job",
              targetId: "job-missing",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: jobMissingSnapshot.snapshot
            },
            {
              id: "decision-job-malformed",
              companyId,
              changeNoticeId,
              targetType: "job",
              targetId: "job-malformed",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: {
                ...jobMalformedSnapshot.snapshot,
                remainingQuantity: 999
              }
            }
          ]
        })
      },
      {
        targetType: "jobMaterial" as const,
        missingId: "material-missing",
        malformedId: "material-malformed",
        rows: baseImpactRows({
          job: [jobRow("job-material-parent")],
          jobMakeMethod: [rootRow("job-material-parent")],
          jobMaterial: [
            materialRow("material-malformed", "job-material-parent")
          ],
          changeOrderImpactDecision: [
            {
              id: "decision-material-missing",
              companyId,
              changeNoticeId,
              targetType: "jobMaterial",
              targetId: "material-missing",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: materialMissingSnapshot.snapshot
            },
            {
              id: "decision-material-malformed",
              companyId,
              changeNoticeId,
              targetType: "jobMaterial",
              targetId: "material-malformed",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: {
                ...materialMalformedSnapshot.snapshot,
                requiredQuantity: 5.000001
              }
            }
          ]
        })
      }
    ];

    for (const entry of cases) {
      const result = await getChangeNoticeImpactCandidates(
        fakeImpactClient({ rows: entry.rows }),
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      const missing = result.data?.candidates.find(
        (candidate) => candidate.targetId === entry.missingId
      );
      const malformed = result.data?.candidates.find(
        (candidate) => candidate.targetId === entry.malformedId
      );

      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "partial",
        currentExposureCount: null,
        historicalReferenceCount: null,
        unassessedCount: null
      });
      expect(missing).toMatchObject({
        targetType: entry.targetType,
        targetId: entry.missingId,
        parent: null,
        item: null,
        currentSnapshot: null,
        exposureClassification: null,
        sourceAvailability: "Unavailable",
        freshness: "Unknown",
        decision: {
          status: "Action required",
          persistedSnapshot: expect.any(Object)
        }
      });
      expect(missing?.sourceAvailability).not.toBe("Source deleted");
      expect(malformed).toMatchObject({
        targetType: entry.targetType,
        targetId: entry.malformedId,
        currentSnapshot: expect.any(Object),
        sourceAvailability: "Unavailable",
        freshness: "Unknown",
        decision: {
          status: "Action required",
          persistedSnapshot: null
        }
      });
      expect(malformed?.sourceAvailability).not.toBe("Source deleted");
    }
  });

  it("marks schema-permitted empty persisted decision IDs partial without fake targets", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-good"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-good")],
      purchaseOrder: [poParent("po-pol-good")],
      changeOrderImpactDecision: [
        {
          id: "decision-empty-target",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "corrupt target identity",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        },
        {
          id: "",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-missing-decision-id",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "corrupt decision identity",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        },
        {
          id: "decision-padded-target",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: " pol-deleted ",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "corrupt target identity",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: {
            ...stored.snapshot,
            purchaseOrderLineId: " pol-deleted "
          }
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(
      result.data?.candidates.some((candidate) => candidate.targetId === "")
    ).toBe(false);
    expect(
      result.data?.candidates.some(
        (candidate) => candidate.sourceAvailability === "Source deleted"
      )
    ).toBe(false);
    expect(
      result.data?.candidates.find(
        (candidate) => candidate.targetId === "pol-good"
      )
    ).toMatchObject({
      sourceAvailability: "Present",
      decision: null
    });
  });

  it("marks malformed provenance on a known decision partial while preserving valid evidence", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-1"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows: baseImpactRows({
          purchaseOrderLine: [poRow("pol-1")],
          purchaseOrder: [poParent("po-pol-1")],
          changeOrderImpactDecision: [
            {
              id: "decision-pol-1",
              companyId,
              changeNoticeId,
              targetType: "purchaseOrderLine",
              targetId: "pol-1",
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: stored.snapshot
            }
          ],
          changeOrderImpactDecisionAffectedItem: [
            {
              decisionId: "decision-pol-1",
              affectedItemId: "affected-1",
              affectedItemSourceId: "item-1",
              affectedItemLabel: null,
              endedAt: null,
              endedReason: null,
              companyId
            },
            {
              decisionId: "decision-pol-1",
              affectedItemId: "",
              affectedItemSourceId: "item-1",
              affectedItemLabel: null,
              endedAt: null,
              endedReason: null,
              companyId
            }
          ]
        })
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-1"
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "partial",
      currentExposureCount: null,
      historicalReferenceCount: null
    });
    expect(candidate).toMatchObject({
      sourceAvailability: "Present",
      decision: { status: "Action required" },
      freshness: "Current"
    });
    expect(candidate?.currentProvenance).toHaveLength(1);
    expect(candidate?.currentProvenance[0]).toMatchObject({
      affectedItemId: "affected-1",
      status: "Current"
    });
  });

  it("does not query any source or persisted domain when access resolution failed", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: [poRow("secret-line")],
        purchaseOrder: [poParent("po-secret-line")]
      })
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess: {
          status: "failed",
          errorMessage: "internal permission lookup failed"
        }
      }
    );
    expect(result.error).toBeNull();
    expect(result.data?.candidates).toEqual([]);
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("failed");
    expect(result.data?.coverage.job.status).toBe("failed");
    expect(result.data?.coverage.jobMaterial.status).toBe("failed");
    expect(client.queries).toEqual([]);
  });

  it("isolates wrong-company source rows through every company predicate", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({
        purchaseOrderLine: [
          poRow("wrong-company", "item-1", { companyId: "company-2" })
        ],
        purchaseOrder: [poParent("po-wrong-company")]
      })
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(
      result.data?.candidates.some(
        (candidate) => candidate.targetId === "wrong-company"
      )
    ).toBe(false);
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("complete");
  });

  it("returns restricted production coverage without querying Job or Job Material sources", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({
        job: [jobRow("hidden-job")],
        jobMaterial: [materialRow("hidden-material", "hidden-job")]
      })
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess: {
          purchaseOrderLine: true,
          job: false,
          jobMaterial: false
        }
      }
    );
    expect(result.data?.coverage.job.status).toBe("restricted");
    expect(result.data?.coverage.jobMaterial.status).toBe("restricted");
    expect(client.queries.includes("job")).toBe(false);
    expect(client.queries.includes("jobMaterial")).toBe(false);
  });

  it("deduplicates one target while retaining current and historical provenance causes", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(
      poRow("pol-1", "item-1", { purchaseOrderStatus: "Completed" })
    );
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-1")],
      purchaseOrder: [poParent("po-pol-1", "Completed")],
      purchaseOrderDelivery: [
        { id: "po-pol-1", receiptPromisedDate: null, companyId }
      ],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-1",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-1",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ],
      changeOrderImpactDecisionAffectedItem: [
        {
          decisionId: "decision-pol-1",
          affectedItemId: "affected-old",
          affectedItemSourceId: "item-old",
          affectedItemLabel: null,
          endedAt: "2026-08-24T00:00:00Z",
          endedReason: "Affected item removed from Change Notice",
          companyId
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetType === "purchaseOrderLine"
    );
    expect(candidate).toMatchObject({
      currentSnapshot: stored.snapshot,
      decision: { persistedSnapshot: stored.snapshot },
      freshness: "Current"
    });
    expect(candidate?.currentProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "affected-1",
        affectedItemSourceId: "item-1",
        status: "Current"
      })
    ]);
    expect(candidate?.historicalProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "affected-old",
        affectedItemSourceId: "item-old",
        status: "Historical",
        endedReason: "Affected item removed from Change Notice"
      })
    ]);
    expect(candidate?.exposureClassification).toBe("Historical reference");
    expect(
      result.data?.candidates.filter((entry) => entry.targetId === "pol-1")
    ).toHaveLength(1);
    expect(
      result.data?.coverage.purchaseOrderLine.historicalReferenceCount
    ).toBe(1);
  });

  it("keeps a null promised date when the required delivery row exists", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-null-date")],
      purchaseOrder: [poParent("po-pol-null-date")],
      purchaseOrderDelivery: [
        { id: "po-pol-null-date", receiptPromisedDate: null, companyId }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-null-date"
    );
    expect(candidate?.sourceAvailability).toBe("Present");
    expect(candidate?.currentSnapshot).toMatchObject({ promisedDate: null });
  });

  it("marks a missing required delivery row Unavailable instead of treating it as a null date", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-missing-delivery")],
      purchaseOrder: [poParent("po-pol-missing-delivery")],
      purchaseOrderDelivery: []
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-missing-delivery"
    );
    expect(candidate?.sourceAvailability).toBe("Unavailable");
    expect(candidate?.unavailableReason).toContain("delivery");
  });

  it("uses the line promised date before the delivery fallback", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [
        poRow("pol-1", "item-1", { promisedDate: "2026-09-01" })
      ],
      purchaseOrder: [poParent("po-pol-1")],
      purchaseOrderDelivery: [
        { id: "po-pol-1", receiptPromisedDate: "2026-09-30", companyId }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetType === "purchaseOrderLine"
    );
    expect(candidate?.currentSnapshot).toMatchObject({
      promisedDate: "2026-09-01"
    });
  });

  it("reconciles a persisted decision against the current canonical snapshot without writing", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("pol-1"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-1", "item-1", { quantityReceived: 3 })],
      purchaseOrder: [poParent("po-pol-1")],
      changeOrderImpactDecision: [
        {
          id: "decision-pol-1",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "pol-1",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "Supplier follow-up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ]
    });
    const client = fakeImpactClient({ rows });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-1"
    );
    expect(candidate?.decision?.status).toBe("Action required");
    expect(candidate?.decision?.decisionStatus).toBe("Action required");
    expect(candidate?.freshness).toBe("Changed since assessment");
    expect(
      result.data?.candidates.filter((entry) => entry.targetId === "pol-1")
    ).toHaveLength(1);
    expect(
      client.queries.some((table) => table === "changeOrderImpactDecision")
    ).toBe(true);
  });

  it("returns restricted coverage without querying the restricted source or leaking identities", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("secret-line")],
      purchaseOrder: [poParent("po-secret-line")]
    });
    const client = fakeImpactClient({ rows });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess: {
          purchaseOrderLine: false,
          job: true,
          jobMaterial: true
        }
      }
    );
    expect(result.data?.coverage.purchaseOrderLine).toMatchObject({
      status: "restricted",
      currentExposureCount: null,
      historicalReferenceCount: null,
      unassessedCount: null
    });
    expect(
      result.data?.candidates.some(
        (candidate) => candidate.targetId === "secret-line"
      )
    ).toBe(false);
    expect(client.queries.includes("purchaseOrderLine")).toBe(false);
  });

  it("paginates persisted decisions instead of losing rows past the PostgREST cap", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("stored"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const decisions = Array.from({ length: 1001 }, (_, index) => {
      const targetId = `deleted-${index.toString().padStart(4, "0")}`;
      return {
        id: `decision-${index.toString().padStart(4, "0")}`,
        companyId,
        changeNoticeId,
        targetType: "purchaseOrderLine",
        targetId,
        decisionStatus: "Action required",
        noActionReasonCode: null,
        rationale: "follow up",
        resolutionNote: null,
        revision: 1,
        snapshotVersion: 1,
        assessmentSnapshot: {
          ...stored.snapshot,
          purchaseOrderLineId: targetId
        }
      };
    });
    const client = fakeImpactClient({
      maxRows: 1000,
      rows: baseImpactRows({ changeOrderImpactDecision: decisions })
    });
    const first = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 500 }
    );
    const firstCandidates = first.data?.candidates.filter(
      (candidate) => candidate.targetType === "purchaseOrderLine"
    );
    expect(firstCandidates).toHaveLength(500);
    expect(
      firstCandidates?.slice(0, 2).map((candidate) => candidate.targetId)
    ).toEqual(["deleted-0000", "deleted-0001"]);
    expect(first.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: "deleted-0499"
    });

    const second = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 500,
        cursor: { purchaseOrderLine: { historical: "deleted-0499" } }
      }
    );
    const secondCandidates = second.data?.candidates.filter(
      (candidate) => candidate.targetType === "purchaseOrderLine"
    );
    expect(secondCandidates).toHaveLength(500);
    expect(second.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: "deleted-0999"
    });

    const third = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      {
        sourceAccess,
        limit: 500,
        cursor: { purchaseOrderLine: { historical: "deleted-0999" } }
      }
    );
    const thirdCandidates = third.data?.candidates.filter(
      (candidate) => candidate.targetType === "purchaseOrderLine"
    );
    expect(thirdCandidates).toHaveLength(1);
    expect(thirdCandidates?.[0]).toMatchObject({
      targetId: "deleted-1000",
      sourceAvailability: "Source deleted"
    });
    expect(third.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: null,
      historical: null
    });
  });

  it("fails closed when persisted Impact state cannot be read", async () => {
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-persisted-failure")],
      purchaseOrder: [poParent("po-pol-persisted-failure")]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({
        rows,
        errors: new Set(["changeOrderImpactDecision"])
      }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "pol-persisted-failure"
    );
    expect(candidate).toMatchObject({
      sourceAvailability: "Unavailable",
      exposureClassification: null,
      decision: null,
      freshness: "Unknown"
    });
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("failed");
  });

  it("reports failed source coverage rather than returning a safe empty result", async () => {
    const client = fakeImpactClient({
      rows: baseImpactRows({ purchaseOrderLine: [poRow("pol-1")] }),
      errors: new Set(["purchaseOrderLine"])
    });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(result.error).toBeNull();
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("failed");
    expect(
      result.data?.coverage.purchaseOrderLine.currentExposureCount
    ).toBeNull();
  });

  it("keeps current and historical paging independent for persisted references", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("missing"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [poRow("pol-1"), poRow("pol-2")],
      purchaseOrder: [poParent("po-pol-1"), poParent("po-pol-2")],
      changeOrderImpactDecision: [
        {
          id: "decision-missing",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "missing",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess, limit: 1 }
    );
    const missing = result.data?.candidates.find(
      (candidate) => candidate.targetId === "missing"
    );
    // Historical paging is independent from the current page. The complete
    // semantic scan proves the persisted source is deleted without using the
    // visible current page as deletion evidence.
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("complete");
    expect(result.data?.coverage.purchaseOrderLine.nextCursor).toEqual({
      current: "pol-1",
      historical: null
    });
    expect(result.data?.coverage.purchaseOrderLine.currentExposureCount).toBe(
      2
    );
    expect(missing?.sourceAvailability).toBe("Source deleted");
  });

  it("establishes Source deleted only after a complete authorized lookup", async () => {
    const stored = normalizePurchaseOrderLineImpactSnapshot(poRow("deleted"));
    expect(stored.sourceAvailability).toBe("Present");
    if (stored.sourceAvailability !== "Present") return;
    const rows = baseImpactRows({
      purchaseOrderLine: [],
      purchaseOrder: [],
      changeOrderImpactDecision: [
        {
          id: "decision-deleted",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "deleted",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: stored.snapshot
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const deleted = result.data?.candidates.find(
      (candidate) => candidate.targetId === "deleted"
    );
    expect(result.data?.coverage.purchaseOrderLine.status).toBe("complete");
    expect(deleted?.sourceAvailability).toBe("Source deleted");
    expect(deleted?.exposureClassification).toBe("Historical reference");
  });

  it("classifies an existing source target outside the current affected-item scope without calling it deleted", async () => {
    const rows = baseImpactRows({
      item: [
        {
          id: "item-2",
          readableId: "PART-2",
          readableIdWithRevision: "PART-2.A",
          revision: "A",
          unitOfMeasureCode: "EA",
          companyId
        }
      ],
      purchaseOrderLine: [poRow("out-of-scope", "item-2")],
      purchaseOrder: [poParent("po-out-of-scope")],
      changeOrderImpactDecision: [
        {
          id: "decision-out",
          companyId,
          changeNoticeId,
          targetType: "purchaseOrderLine",
          targetId: "out-of-scope",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "follow up",
          resolutionNote: null,
          revision: 1,
          snapshotVersion: 1,
          assessmentSnapshot: normalizePurchaseOrderLineImpactSnapshot(
            poRow("out-of-scope", "item-2")
          ).snapshot
        }
      ],
      changeOrderImpactDecisionAffectedItem: [
        {
          decisionId: "decision-out",
          affectedItemId: "removed-affected-item",
          affectedItemSourceId: "item-old",
          affectedItemLabel: null,
          endedAt: "2026-08-24T00:00:00Z",
          endedReason: "Affected item removed from Change Notice",
          companyId
        }
      ]
    });
    const result = await getChangeNoticeImpactCandidates(
      fakeImpactClient({ rows }),
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    const candidate = result.data?.candidates.find(
      (entry) => entry.targetId === "out-of-scope"
    );
    expect(candidate?.sourceAvailability).toBe("Present");
    expect(candidate?.exposureClassification).toBe(
      "No longer in current scope"
    );
    expect(candidate?.sourceAvailability).not.toBe("Source deleted");
    expect(candidate?.historicalProvenance).toEqual([
      expect.objectContaining({
        affectedItemId: "removed-affected-item",
        affectedItemLabel: "Affected item"
      })
    ]);
    expect(
      result.data?.coverage.purchaseOrderLine.historicalReferenceCount
    ).toBe(1);
  });

  it("does not discover new source population for a Cancelled Change Notice", async () => {
    const rows = baseImpactRows({
      changeOrder: [
        {
          id: changeNoticeId,
          companyId,
          status: "Cancelled",
          changeOrderId: "CN-1",
          name: "Cancelled Change"
        }
      ],
      purchaseOrderLine: [poRow("new-after-cancel")],
      purchaseOrder: [poParent("po-new-after-cancel")]
    });
    const client = fakeImpactClient({ rows });
    const result = await getChangeNoticeImpactCandidates(
      client,
      companyId,
      changeNoticeId,
      { sourceAccess }
    );
    expect(
      result.data?.candidates.some(
        (candidate) => candidate.targetId === "new-after-cancel"
      )
    ).toBe(false);
    expect(client.queries.includes("purchaseOrderLine")).toBe(false);
  });

  it("keeps persisted active PO, Job, and Job Material targets current when Cancelled", async () => {
    const cases = [
      {
        targetType: "purchaseOrderLine" as const,
        targetId: "pol-cancelled",
        sourceRows: {
          purchaseOrderLine: [
            poRow("pol-cancelled"),
            poRow("pol-new-after-cancel")
          ],
          purchaseOrder: [
            poParent("po-pol-cancelled"),
            poParent("po-pol-new-after-cancel")
          ]
        },
        snapshot: normalizePurchaseOrderLineImpactSnapshot(
          poRow("pol-cancelled")
        )
      },
      {
        targetType: "job" as const,
        targetId: "job-cancelled",
        sourceRows: {
          job: [jobRow("job-cancelled"), jobRow("job-new-after-cancel")],
          jobMakeMethod: [
            rootRow("job-cancelled"),
            rootRow("job-new-after-cancel")
          ]
        },
        snapshot: normalizeJobImpactSnapshot(
          baseJobInput({
            jobId: "job-cancelled",
            effectiveMethodId: "root-job-cancelled"
          })
        )
      },
      {
        targetType: "jobMaterial" as const,
        targetId: "material-cancelled",
        sourceRows: {
          job: [jobRow("job-material-cancelled")],
          jobMakeMethod: [rootRow("job-material-cancelled")],
          jobMaterial: [
            materialRow("material-cancelled", "job-material-cancelled"),
            materialRow("material-new-after-cancel", "job-material-cancelled")
          ]
        },
        snapshot: normalizeJobMaterialImpactSnapshot(
          baseMaterialInput({
            jobMaterialId: "material-cancelled",
            jobId: "job-material-cancelled"
          })
        )
      }
    ];

    for (const entry of cases) {
      expect(entry.snapshot.sourceAvailability).toBe("Present");
      if (entry.snapshot.sourceAvailability !== "Present") continue;
      const client = fakeImpactClient({
        rows: baseImpactRows({
          changeOrder: [
            {
              id: changeNoticeId,
              companyId,
              status: "Cancelled",
              changeOrderId: "CN-1",
              name: "Cancelled Change"
            }
          ],
          ...entry.sourceRows,
          changeOrderImpactDecision: [
            {
              id: `decision-${entry.targetId}`,
              companyId,
              changeNoticeId,
              targetType: entry.targetType,
              targetId: entry.targetId,
              decisionStatus: "Action required",
              noActionReasonCode: null,
              rationale: "follow up",
              resolutionNote: null,
              revision: 1,
              snapshotVersion: 1,
              assessmentSnapshot: entry.snapshot.snapshot
            }
          ]
        })
      });
      const result = await getChangeNoticeImpactCandidates(
        client,
        companyId,
        changeNoticeId,
        { sourceAccess }
      );
      const candidate = result.data?.candidates.find(
        (item) =>
          item.targetType === entry.targetType &&
          item.targetId === entry.targetId
      );
      expect(candidate).toMatchObject({
        sourceAvailability: "Present",
        exposureClassification: "Current operational exposure",
        currentProvenance: [
          expect.objectContaining({
            affectedItemId: "affected-1",
            status: "Current"
          })
        ],
        historicalProvenance: [],
        decision: { status: "Action required" },
        freshness: "Current"
      });
      expect(
        result.data?.candidates.some((item) =>
          item.targetId.endsWith("new-after-cancel")
        )
      ).toBe(false);
      expect(result.data?.coverage[entry.targetType]).toMatchObject({
        status: "complete",
        currentExposureCount: 1,
        historicalReferenceCount: 0
      });
    }
  });

  it("does not restart an exhausted stream while the other stream continues", async () => {
    const scenarios = [
      {
        current: ["curr-a"],
        historical: ["hist-a", "hist-b", "hist-c"]
      },
      {
        current: ["curr-a", "curr-b", "curr-c"],
        historical: ["hist-a"]
      }
    ];

    for (const scenario of scenarios) {
      const rows = baseImpactRows({
        purchaseOrderLine: [
          ...scenario.current.map((id) => poRow(id)),
          ...scenario.historical.map((id) => poRow(id))
        ],
        purchaseOrder: [
          ...scenario.current.map((id) => poParent(`po-${id}`)),
          ...scenario.historical.map((id) => poParent(`po-${id}`, "Completed"))
        ]
      });
      const client = fakeImpactClient({ rows });
      const seenCurrent: string[] = [];
      const seenHistorical: string[] = [];
      let cursor:
        | {
            purchaseOrderLine: {
              current: string | null;
              historical: string | null;
            };
          }
        | undefined;
      let terminated = false;

      for (let request = 0; request < 10; request += 1) {
        const result = await getChangeNoticeImpactCandidates(
          client,
          companyId,
          changeNoticeId,
          { sourceAccess, limit: 1, ...(cursor ? { cursor } : {}) }
        );
        const purchaseCandidates = result.data?.candidates.filter(
          (candidate) => candidate.targetType === "purchaseOrderLine"
        );
        const current = purchaseCandidates?.find(
          (candidate) =>
            candidate.exposureClassification === "Current operational exposure"
        );
        const historical = purchaseCandidates?.find(
          (candidate) =>
            candidate.exposureClassification === "Historical reference"
        );
        if (current) seenCurrent.push(current.targetId);
        if (historical) seenHistorical.push(historical.targetId);

        const nextCursor = result.data?.coverage.purchaseOrderLine.nextCursor;
        expect(nextCursor).toBeDefined();
        cursor = { purchaseOrderLine: nextCursor! };
        if (nextCursor?.current === null && nextCursor.historical === null) {
          terminated = true;
          break;
        }
      }

      expect(terminated).toBe(true);
      expect(seenCurrent).toEqual(scenario.current);
      expect(seenHistorical).toEqual(scenario.historical);
      expect(new Set(seenCurrent).size).toBe(seenCurrent.length);
      expect(new Set(seenHistorical).size).toBe(seenHistorical.length);
    }
  });
});
