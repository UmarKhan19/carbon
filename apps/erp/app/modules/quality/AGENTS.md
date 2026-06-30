# Quality Module

Inspections, non-conformances (issues/NCRs), corrective/preventive actions (CAPAs), gauge management and calibration, quality documents, inspection documents with balloon annotations, inbound inspections with sampling plans, and risk registers.

## Key Domain Concepts

- **Issues (NCRs)** — non-conformance records. Statuses: Registered → In Progress → Closed. Have associations to items, customers, suppliers, job operations, PO/SO lines, shipment/receipt lines, tracked entities, and inbound inspections. Workflows define required tasks and approval paths.
- **Issue Workflows** — configurable multi-step workflows with action tasks and approval tasks. `nonConformanceWorkflow` + `nonConformanceRequiredAction` define what must happen before closure.
- **Inspection Documents** — PDF-based drawings with balloon annotations. Balloons link to inspection features (dimensions with nominal/tolerance values). Used for FAI and in-process inspection.
- **Inbound Inspections** — triggered on receipt; uses statistical sampling plans (AQL-based). Samples are linked to tracked entities. Statuses drive accept/reject/hold decisions.
- **Gauges** — measurement instruments with calibration tracking. Types, calibration records, and status (Active/Inactive). Roles: Master or Standard.
- **Quality Documents** — versioned SOPs/work instructions with steps (similar to procedures).
- **Risk Register** — risks and opportunities tracked by source (Customer, Supplier, Item, etc.).
- **Sampling Plans** — AQL-based sampling standards (ANSI/ASQ Z1.4) with inspection levels and severity.

## Safety

### Always
- Check `isIssueLocked(status)` before allowing edits — Closed issues are locked.
- Use the association system (`deleteIssueAssociation` with type parameter) for managing NCR links — it handles 10+ association types.
- Scope by `companyId` on all queries.

### Ask First
- Closing issues that have incomplete required actions or pending approval tasks.
- Deleting inspection documents that have recorded measurements.
- Deactivating issue workflows that are in use by open issues.

### Never
- Delete gauges with active calibration records — deactivate instead.
- Bypass the workflow task/approval requirements when closing an issue.
- Hard-delete issue workflows — use soft delete (`active: false`) via `deleteIssueWorkflow`.

## Key Data Model

| Table | Purpose |
|---|---|
| `nonConformance` | Issue/NCR header: status, priority, source, type, assignee |
| `nonConformanceType` | Issue categories (configurable) |
| `nonConformanceWorkflow` | Multi-step workflow definitions |
| `nonConformanceRequiredAction` | Actions required before closure |
| `nonConformanceItem/Customer/Supplier/...` | Association tables (10+ types) |
| `inspectionDocument` | PDF drawing with balloon overlay |
| `inspectionBalloon` / `inspectionFeature` | Annotated dimensions on drawings |
| `inboundInspection` / `inboundInspectionSample` | Receipt inspection with sampling |
| `gauges` / `gaugeCalibrationRecord` / `gaugeType` | Measurement instrument tracking |
| `qualityDocument` / `qualityDocumentStep` | Versioned SOPs |
| `riskRegister` | Risk/opportunity tracking |
| `itemSamplingPlan` | AQL sampling plan per item |

## Key Service Functions

- `getIssue`, `getIssues`, `getIssueAssociations` — NCR reads with all association types
- `getIssueWorkflow`, `getIssueActionTasks`, `getIssueApprovalTasks` — workflow state
- `getIssueReviewers`, `getIssueItems` — NCR details
- `getInspectionDocument`, `getBalloons`, `getInspectionFeatures` — drawing inspection
- `getInboundInspection`, `getInboundInspections` — receipt inspections
- `getGauge`, `getGauges`, `getGaugeCalibrationRecords` — gauge management
- `getQualityDocument`, `getQualityDocumentSteps` — SOPs
- `getRisk`, `getRisks` — risk register
- `getQualityActions` — corrective/preventive actions

## Related Modules

- **inventory** — inbound inspections triggered on receipt; tracked entities linked to NCRs
- **production** — job operations can be associated with NCRs; scrap reasons overlap
- **purchasing** — PO lines and receipt lines can be NCR associations; supplier NCRs
- **sales** — SO lines and shipment lines can be NCR associations; customer NCRs
- **items** — items linked to NCRs; `requiresInspection` flag; inspection documents reference parts
- **resources** — failure modes shared between quality and maintenance
