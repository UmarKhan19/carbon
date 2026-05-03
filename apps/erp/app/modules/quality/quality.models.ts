import { z } from "zod";
import { zfd } from "zod-form-data";
import { procedureStepType } from "../shared/shared.models";

export const disposition = [
  // "Conditional Acceptance",
  // "Deviation Accepted",
  // "Hold",
  // "No Action Required",
  "Pending",
  // "Quarantine",
  // "Repair",
  // "Return to Supplier",
  "Rework",
  "Scrap",
  "Use As Is"
] as const;

export const gaugeStatus = ["Active", "Inactive"] as const;
export const gaugeCalibrationStatus = [
  "Pending",
  "In-Calibration",
  "Out-of-Calibration"
] as const;

export const gaugeRole = ["Master", "Standard"] as const;

export const nonConformanceApprovalRequirement = ["MRB"] as const;

export const nonConformanceSource = ["Internal", "External"] as const;

export const nonConformanceStatus = [
  "Registered",
  "In Progress",
  "Closed"
] as const;

export function isIssueLocked(status: string | null | undefined): boolean {
  return status === "Closed";
}

export const nonConformanceTaskStatus = [
  "Pending",
  "In Progress",
  "Completed",
  "Skipped"
] as const;

export const nonConformancePriority = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const;

export const nonConformanceAssociationType = [
  "items",
  "customers",
  "suppliers",
  "jobOperations",
  "purchaseOrderLines",
  "salesOrderLines",
  "shipmentLines",
  "receiptLines",
  "trackedEntities"
] as const;

export const qualityDocumentStatus = ["Draft", "Active", "Archived"] as const;

export const riskSource = [
  "Customer",
  "General",
  "Item",
  "Job",
  "Quote Line",
  "Supplier",
  "Work Center"
] as const;

export const riskStatus = [
  "Open",
  "In Review",
  "Mitigating",
  "Closed",
  "Accepted"
] as const;

export const riskRegisterType = ["Risk", "Opportunity"] as const;

export const balloonCharacteristicType = [
  "Critical",
  "Major",
  "Minor",
  "Reference"
] as const;

export const inspectionDocumentValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: zfd.text(z.string().optional()),
  partId: z.string().min(1, { message: "Part is required" }),
  drawingNumber: zfd.text(z.string().optional()),
  pdfUrl: zfd.text(z.string().optional()),
  annotations: zfd.text(z.string().optional()),
  features: zfd.text(z.string().optional())
});

export const balloonFeatureValidator = z.object({
  id: zfd.text(z.string().optional()),
  inspectionDocumentId: z.string().min(1, { message: "Diagram is required" }),
  balloonNumber: zfd.numeric(z.number().min(1)),
  description: z.string().min(1, { message: "Description is required" }),
  nominalValue: zfd.numeric(z.number().optional()),
  tolerancePlus: zfd.numeric(z.number().optional()),
  toleranceMinus: zfd.numeric(z.number().optional()),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  characteristicType: z.enum(balloonCharacteristicType).optional(),
  sortOrder: zfd.numeric(z.number().optional())
});

export const balloonCreateFromPayloadItemValidator = z.object({
  pageNumber: z.number(),
  regionX: z.number(),
  regionY: z.number(),
  regionWidth: z.number(),
  regionHeight: z.number(),
  label: z.string().min(1),
  xCoordinate: z.number(),
  yCoordinate: z.number(),
  nominalValue: z.string().nullable().optional(),
  tolerancePlus: z.string().nullable().optional(),
  toleranceMinus: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  description: z.string().nullable().optional()
});

export const balloonUpdateItemValidator = z.object({
  id: z.string().min(1),
  pageNumber: z.number().optional(),
  regionX: z.number().optional(),
  regionY: z.number().optional(),
  regionWidth: z.number().optional(),
  regionHeight: z.number().optional(),
  label: z.string().optional(),
  xCoordinate: z.number().optional(),
  yCoordinate: z.number().optional(),
  nominalValue: z.string().nullable().optional(),
  tolerancePlus: z.string().nullable().optional(),
  toleranceMinus: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  description: z.string().nullable().optional()
});

export const balloonDeleteValidator = z.object({
  ids: z.array(z.string().min(1))
});

const normalizedCoordinateValidator = z.number().min(0).max(1);
const normalizedSizeValidator = z.number().gt(0).max(1);
const pageNumberValidator = z.number().int().min(1);

export const balloonAnchorCreateItemValidator = z
  .object({
    pageNumber: pageNumberValidator,
    regionX: normalizedCoordinateValidator,
    regionY: normalizedCoordinateValidator,
    regionWidth: normalizedSizeValidator,
    regionHeight: normalizedSizeValidator
  })
  .strict();

export const balloonCreateItemWithOverlayValidator = z
  .object({
    pageNumber: pageNumberValidator,
    regionX: normalizedCoordinateValidator,
    regionY: normalizedCoordinateValidator,
    regionWidth: normalizedSizeValidator,
    regionHeight: normalizedSizeValidator,
    label: z.string().min(1),
    xCoordinate: normalizedCoordinateValidator,
    yCoordinate: normalizedCoordinateValidator,
    nominalValue: z.string().nullable().optional(),
    tolerancePlus: z.string().nullable().optional(),
    toleranceMinus: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    data: z.record(z.unknown()).optional()
  })
  .strict();

export const balloonCreateItemsValidator = z.array(
  z.union([
    balloonCreateItemWithOverlayValidator,
    balloonAnchorCreateItemValidator
  ])
);

export const balloonUpdateItemsValidator = z.array(
  balloonUpdateItemValidator.extend({
    pageNumber: pageNumberValidator.optional(),
    regionX: normalizedCoordinateValidator.optional(),
    regionY: normalizedCoordinateValidator.optional(),
    regionWidth: normalizedSizeValidator.optional(),
    regionHeight: normalizedSizeValidator.optional(),
    xCoordinate: normalizedCoordinateValidator.optional(),
    yCoordinate: normalizedCoordinateValidator.optional(),
    data: z.record(z.unknown()).optional()
  })
);

export const balloonDeleteIdsValidator = z.array(z.string().min(1));

export const inspectionSaveBalloonCreateItemValidator = z
  .object({
    tempBalloonAnchorId: z.string().min(1),
    label: z.string().min(1),
    xCoordinate: normalizedCoordinateValidator,
    yCoordinate: normalizedCoordinateValidator,
    nominalValue: z.string().nullable().optional(),
    tolerancePlus: z.string().nullable().optional(),
    toleranceMinus: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    description: z.string().nullable().optional()
  })
  .strict();

export const inspectionSaveBalloonUpdateItemValidator = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    xCoordinate: normalizedCoordinateValidator.optional(),
    yCoordinate: normalizedCoordinateValidator.optional(),
    nominalValue: z.string().nullable().optional(),
    tolerancePlus: z.string().nullable().optional(),
    toleranceMinus: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    description: z.string().nullable().optional()
  })
  .strict();

export const inspectionSaveBalloonsPayloadValidator = z
  .object({
    create: z.array(inspectionSaveBalloonCreateItemValidator).default([]),
    update: z.array(inspectionSaveBalloonUpdateItemValidator).default([]),
    delete: z.array(z.string().min(1)).default([])
  })
  .strict();

export const inspectionSaveAnchorCreateItemValidator = z
  .object({
    tempId: z.string().min(1),
    pageNumber: pageNumberValidator,
    xCoordinate: normalizedCoordinateValidator,
    yCoordinate: normalizedCoordinateValidator,
    width: normalizedSizeValidator,
    height: normalizedSizeValidator
  })
  .strict();

export const inspectionSaveAnchorUpdateItemValidator = z
  .object({
    id: z.string().min(1),
    pageNumber: pageNumberValidator.optional(),
    xCoordinate: normalizedCoordinateValidator.optional(),
    yCoordinate: normalizedCoordinateValidator.optional(),
    width: normalizedSizeValidator.optional(),
    height: normalizedSizeValidator.optional()
  })
  .strict();

export const inspectionSaveAnchorsPayloadValidator = z
  .object({
    create: z.array(inspectionSaveAnchorCreateItemValidator).default([]),
    update: z.array(inspectionSaveAnchorUpdateItemValidator).default([]),
    delete: z.array(z.string().min(1)).default([])
  })
  .strict();

export const gaugeValidator = z.object({
  id: zfd.text(z.string().optional()),
  gaugeId: zfd.text(z.string().optional()),
  supplierId: zfd.text(z.string().optional()),
  modelNumber: zfd.text(z.string().optional()),
  serialNumber: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  dateAcquired: zfd.text(z.string().optional()),
  gaugeTypeId: z.string().min(1, { message: "Type is required" }),
  // gaugeCalibrationStatus: z.enum(gaugeCalibrationStatus),
  // gaugeStatus: z.enum(gaugeStatus),
  gaugeRole: z.enum(gaugeRole),
  lastCalibrationDate: zfd.text(z.string().optional()),
  nextCalibrationDate: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  shelfId: zfd.text(z.string().optional()),
  calibrationIntervalInMonths: zfd.numeric(
    z.number().min(1, {
      message: "Calibration interval is required"
    })
  )
});

export const calibrationAttempt = z.object({
  reference: zfd.numeric(z.number()),
  actual: zfd.numeric(z.number())
});

export const gaugeCalibrationRecordValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  gaugeId: z.string().min(1, { message: "Gauge is required" }),
  supplierId: zfd.text(z.string().optional()),
  dateCalibrated: z.string().min(1, { message: "Date is required" }),
  requiresAction: zfd.checkbox(),
  requiresAdjustment: zfd.checkbox(),
  requiresRepair: zfd.checkbox(),
  temperature: zfd.numeric(z.number().min(-200).max(500).optional()),
  humidity: zfd.numeric(z.number().min(0).max(1).optional()),
  approvedBy: zfd.text(z.string().optional()),
  measurementStandard: zfd.text(z.string().optional()),
  calibrationAttempts: zfd.repeatableOfType(calibrationAttempt),
  notes: z
    .string()
    .optional()
    .transform((val) => {
      try {
        return val ? JSON.parse(val) : {};
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        return {};
      }
    })
});

export const gaugeTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});

export const issueAssociationValidator = z
  .object({
    type: z.enum(nonConformanceAssociationType),
    id: z.string(),
    lineId: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().min(0).optional())
  })
  .refine(
    (data) => {
      // For types other than items, customer, supplier, or trackedEntity, lineId is required
      if (
        !["items", "customers", "suppliers", "trackedEntities"].includes(
          data.type
        ) &&
        !data.lineId
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Line ID is required"
    }
  );

export const issueValidator = z.object({
  id: zfd.text(z.string().optional()),
  nonConformanceId: zfd.text(z.string().optional()),
  priority: z.enum(nonConformancePriority),
  source: z.enum(nonConformanceSource),
  name: z.string().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional()),
  requiredActionIds: z.array(z.string()).optional(),
  approvalRequirements: z
    .array(z.enum(nonConformanceApprovalRequirement))
    .optional(),
  locationId: z.string().min(1, { message: "Location is required" }),
  nonConformanceWorkflowId: zfd.text(z.string().optional()),
  nonConformanceTypeId: z.string().min(1, { message: "Type is required" }),
  openDate: z.string().min(1, { message: "Open date is required" }),
  dueDate: zfd.text(z.string().optional()),
  closeDate: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number().optional()),
  items: z.array(z.string()).optional(),
  jobOperationId: z.string().optional(),
  customerId: z.string().optional(),
  salesOrderLineId: z.string().optional(),
  operationSupplierProcessId: z.string().optional()
});

export const nonConformanceReviewerValidator = z.object({
  title: z.string().min(1, { message: "Title is required" })
});

export const issueTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});

export const issueWorkflowValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  content: z
    .string()
    .min(1, { message: "Content is required" })
    .transform((val) => {
      try {
        return JSON.parse(val);
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        return {};
      }
    }),
  priority: z.enum(nonConformancePriority),
  source: z.enum(nonConformanceSource),
  requiredActionIds: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return [];
      try {
        return JSON.parse(val) as string[];
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        return [];
      }
    }),
  approvalRequirements: z
    .array(z.enum(nonConformanceApprovalRequirement))
    .optional()
});

export const itemQuantityValidator = z.object({
  quantity: zfd.numeric(z.number().min(0))
});

export const qualityDocumentValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  version: zfd.numeric(z.number().min(0)),
  content: zfd.text(z.string().optional()),
  copyFromId: zfd.text(z.string().optional())
});

export const qualityDocumentStepValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    qualityDocumentId: z
      .string()
      .min(1, { message: "Quality document is required" }),
    name: z.string().min(1, { message: "Name is required" }),
    description: zfd.text(z.string().optional()),
    type: z.enum(procedureStepType, {
      errorMap: () => ({ message: "Type is required" })
    }),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    minValue: zfd.numeric(z.number().min(0).optional()),
    maxValue: zfd.numeric(z.number().min(0).optional()),
    listValues: z.array(z.string()).optional(),
    sortOrder: zfd.numeric(z.number().min(0).optional())
  })
  .refine(
    (data) => {
      if (data.type === "Measurement") {
        return !!data.unitOfMeasureCode;
      }
      return true;
    },
    {
      message: "Unit of measure is required",
      path: ["unitOfMeasureCode"]
    }
  )
  .refine(
    (data) => {
      if (data.type === "List") {
        return (
          !!data.listValues &&
          data.listValues.length > 0 &&
          data.listValues.every((option) => option.trim() !== "")
        );
      }
      return true;
    },
    {
      message: "List options are required",
      path: ["listOptions"]
    }
  )
  .refine(
    (data) => {
      if (data.minValue != null && data.maxValue != null) {
        return data.maxValue >= data.minValue;
      }
      return true;
    },
    {
      message: "Maximum value must be greater than or equal to minimum value",
      path: ["maxValue"]
    }
  );

export const requiredActionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  active: zfd.checkbox()
});

export const qualityDocumentApprovalValidator = z.object({
  approvalRequestId: z
    .string()
    .min(1, { message: "Approval request is required" }),
  decision: z.enum(["Approved", "Rejected"]),
  notes: zfd.text(z.string().optional())
});

export const QualityKPIs = [
  { key: "weeklyTracking", label: "Issue Trend" },
  { key: "statusDistribution", label: "Status Distribution" },
  { key: "paretoByType", label: "Pareto by Type" },
  { key: "ncrsByType", label: "NCRs by Type" },
  { key: "sourceAnalysis", label: "Source Analysis" },
  { key: "supplierQuality", label: "Supplier Quality" },
  { key: "weeksOpen", label: "Weeks Open" }
] as const;

export const riskRegisterValidator = z.object({
  id: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  itemId: zfd.text(z.string().optional()),
  likelihood: z.string().min(1, { message: "Likelihood is required" }),
  notes: z
    .string()
    .optional()
    .transform((val) => {
      try {
        return val ? JSON.parse(val) : {};
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        return {};
      }
    }),
  severity: z.string().min(1, { message: "Severity is required" }),
  source: z.enum(riskSource),
  sourceId: zfd.text(z.string().optional()),
  status: z.enum(riskStatus),
  title: z.string().min(1, { message: "Title is required" }),
  type: z.enum(riskRegisterType)
});
