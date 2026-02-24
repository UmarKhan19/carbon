# Deviation Management - Scope Analysis & Implementation Plan

## Executive Summary

This document analyzes what Carbon already has, how SAP/major ERPs handle deviation management, what Emiliano's proposal covers, and provides a recommendation for what needs to be built new vs. what can leverage existing infrastructure.

**Key Finding:** Carbon's existing NCR (Issue) module already covers ~60-70% of the deviation management requirements. The core question is whether "Deviation" should be a separate entity or an extension of the existing nonConformance system. Our recommendation is to **extend the existing NCR system** rather than build a parallel system.

---

## Part 1: How SAP & Major ERPs Handle Deviations

### SAP QM (Quality Management)

SAP uses **Quality Notifications** as the central mechanism for deviations:

| SAP Notification Type | Purpose | Carbon Equivalent |
|---|---|---|
| **Q1 - Customer Complaint** | External quality issues | NCR with source="External" |
| **Q2 - Vendor Complaint** | Supplier material deviations | NCR with supplier association |
| **Q3 - Internal Defect** | Process/product deviations found internally | NCR with source="Internal" |

**SAP's Deviation Flow:**
1. **Detection** - Quality notification created (shop floor, inspection, receiving)
2. **Classification** - Categorized by type, coded with reason/defect codes
3. **Disposition** - Use-as-is, rework, scrap, return to vendor, concession
4. **Approval** - MRB or engineering disposition with customer approval if required
5. **Corrective Action** - CAPA linked to notification, root cause analysis
6. **Closure** - Verified effectiveness, audit trail complete

**SAP's key distinction:** SAP does NOT have a separate "Deviation" module. Deviations are handled through Quality Notifications + Usage Decisions + CAPA. The term "deviation" in SAP refers to a concession/waiver request, which is a specific disposition type within the notification workflow.

### Oracle Quality Management
- Uses **Quality Actions** and **Nonconformance Reports**
- Disposition codes drive downstream actions (scrap orders, rework orders)
- Customer approval tracked as part of disposition workflow

### Epicor (Kinetic)
- **NCR module** handles all nonconformance types
- **DMR (Discrepant Material Report)** for receiving deviations
- Disposition drives automatic creation of rework jobs or scrap transactions

### Common Pattern Across All ERPs
All major ERPs handle deviations through their NCR/Quality Notification system. None have a standalone "Deviation" module. The pattern is:

```
NCR/Quality Notification
  ├── Classification (type, reason code, severity)
  ├── Affected Items (with traceability links)
  ├── Disposition (accept-as-is, rework, scrap, etc.)
  ├── Approvals (internal MRB + external customer)
  ├── Corrective Actions (CAPA)
  └── Closure (with verified effectiveness)
```

### The "Post-Shipment Containment" Problem (Brad's Question)

SAP handles this through **Quality Notifications with retroactive lot tracking**:
1. Create Q1/Q3 notification identifying affected serial/lot range
2. System traces forward through shipment records to identify which items shipped
3. Field action / customer notification generated
4. Containment action tracked as CAPA task
5. Disposition applied to unshipped items in inventory

**Carbon can handle this today** via the existing NCR + trackedEntity + shipmentLine associations. The NCR already supports linking to shipment lines and tracked entities, which enables identification of shipped vs. unshipped affected items.

---

## Part 2: What Carbon Already Has (Current State)

### 2A. NCR / Issue Module (Quality)

**Database Tables:**
- `nonConformance` - Main record with status workflow (Registered → In Progress → Closed)
- `nonConformanceItem` - Links NCR to affected items with **quantity** and **disposition** (Pending, Rework, Scrap, Use As Is)
- `nonConformanceType` - Customizable types (Design Error, Manufacturing Defect, **Process Deviation**, Material Issue, etc.)
- `nonConformanceWorkflow` - Templates with pre-configured investigation/action/approval requirements
- `nonConformanceActionTask` - Action items (Corrective Action, Preventive Action, **Containment Action**, Verification, Customer Communication)
- `nonConformanceApprovalTask` - MRB approval workflow
- `nonConformanceReviewer` - Reviewer assignments for MRB

**Association Tables (Traceability):**
- `nonConformanceJobOperation` - Links to job operations
- `nonConformancePurchaseOrderLine` - Links to PO lines (supplier material)
- `nonConformanceSalesOrderLine` - Links to SO lines
- `nonConformanceShipmentLine` - Links to shipped items
- `nonConformanceReceiptLine` - Links to received items
- `nonConformanceTrackedEntity` - Links to serial/batch tracked entities
- `nonConformanceCustomer` - Customer association
- `nonConformanceSupplier` - Supplier association with external link support

**Disposition Enum (in DB, partially enabled in UI):**
```
Enabled:  Pending, Rework, Scrap, Use As Is
Disabled: Conditional Acceptance, Deviation Accepted, Hold,
          No Action Required, Quarantine, Repair, Return to Supplier
```

**Action Types (Configurable):**
- Corrective Action, Preventive Action, Containment Action, Verification, Customer Communication
- Investigation types: Root Cause Analysis, Inventory, WIP, Finished Goods, Incoming Materials, Process, Documentation

### 2B. Gauge & Calibration Module

**Fully built and production-ready:**
- `gauge` table with status (Active/Inactive), calibration status (Pending/In-Calibration/Out-of-Calibration)
- `gaugeCalibrationRecord` with pass/fail, environmental conditions, measurement attempts
- `gaugeType` with 20 predefined types (calipers, micrometers, CMM, etc.)
- Automatic next-calibration-date calculation
- Overdue detection
- Full UI (forms, tables, status badges)

**What's MISSING for gauge deviations:** No link between an out-of-calibration gauge and affected product/operations. Brad noted this: "The problem is that it's not tied to the shop floor app for inspections."

### 2C. MES / Shop Floor

**Scrap & Rework Tracking:**
- `productionQuantity` table records Production, Scrap, and Rework separately by type
- MES has dedicated routes: `/x/scrap` and `/x/rework`
- Scrap recording requires a `scrapReasonId` (links to scrap reason codes)
- Scrap triggers material issuance via cloud function
- Rework records quantity but does NOT auto-link to quality/NCR

**NonConformance Actions in MES:**
- Operation detail page fetches `getNonConformanceActions()` for the item/process
- Displays as inspection steps in the job operation UI
- Operators can see containment/corrective actions while working

### 2D. Traceability

**Full DAG-based traceability:**
- `trackedEntity` - Physical items/batches/lots with serial/batch numbers
- `trackedActivity` - Manufacturing transformations
- Forward tracing (where did material go?) and backward tracing (where did it come from?)
- QR code integration
- Graph visualization at `/x/traceability/graph`

### 2E. Approval Workflows

- `approvalRequest` table supports `purchaseOrder` and `qualityDocument` types
- `approvalRule` with escalation, approver groups, thresholds
- Role-based approval routing

### 2F. Audit Logs

- Per-company audit tables (`auditLog_{companyId}`)
- Field-level change diffs
- Already tracks: `nonConformance` entity changes
- 30-day retention with archival

### 2G. Risk Register

- `riskRegister` table with severity x likelihood scoring
- Sources: General, Item, Job, Quote Line, Supplier, Customer, Work Center
- Status workflow: Open → In Review → Mitigating → Closed/Accepted

### 2H. Quality Documents

- `qualityDocument` with versioning and approval workflow
- `qualityDocumentStep` for inspection steps (Measurement, List, etc.)
- Status: Draft → Active → Archived

---

## Part 3: Gap Analysis - Emiliano's Modules vs. What Exists

### MODULE 1: Deviation Core Framework → 90% EXISTS

| Requirement | Status | Notes |
|---|---|---|
| Deviation record with classification | **EXISTS** | `nonConformance` table |
| Deviation types | **EXISTS** | `nonConformanceType` (includes "Process Deviation") |
| Required fields (ID, type, initiator, date, etc.) | **EXISTS** | All fields present |
| Duration (temporary/permanent) | **GAP** | Need to add field |
| Deviation reason code | **PARTIAL** | `nonConformanceType` serves this but could add dedicated reason codes |
| Risk level | **PARTIAL** | Priority (Low/Med/High/Critical) exists; could link to riskRegister |
| Status workflow (Draft→Submitted→Approved→Active→Closed→Rejected) | **PARTIAL** | Currently: Registered→In Progress→Closed. Need to add Draft, Approved, Active, Rejected |
| Audit logging | **EXISTS** | Already tracked |

### MODULE 2: Tool & Gauge Deviation Control → 60% EXISTS

| Requirement | Status | Notes |
|---|---|---|
| Gauge table with calibration tracking | **EXISTS** | Full gauge system built |
| Out-of-tolerance detection | **EXISTS** | calibrationStatus + overdue detection |
| Link gauge to affected product | **GAP** | Need association between gauge and trackedEntities/operations |
| "Under Deviation" flag on gauge | **GAP** | Need new status or flag |
| Alternate gauge/process tracking | **GAP** | Need new fields or association |

### MODULE 3: Documented Information Deviation → 70% EXISTS

| Requirement | Status | Notes |
|---|---|---|
| Document type/number/revision | **EXISTS** | `qualityDocument` with versioning |
| Description of deviation | **EXISTS** | Via NCR content field |
| Affected operation tracking | **EXISTS** | Via `nonConformanceJobOperation` |
| Temp/permanent designation | **GAP** | Need to add field |
| Document change process trigger | **GAP** | Out of scope per Emiliano |

### MODULE 4: Nonconforming Product Control → 85% EXISTS

| Requirement | Status | Notes |
|---|---|---|
| Nonconformance description | **EXISTS** | `nonConformance.description` + `content` |
| Inspection point | **EXISTS** | Via job operation association |
| Engineering disposition | **PARTIAL** | Disposition enum exists but some values commented out |
| Risk assessment | **EXISTS** | Via `riskRegister` linkage |
| Quantity affected | **EXISTS** | `nonConformanceItem.quantity` |
| Customer approval required | **PARTIAL** | MRB approval exists; customer-specific approval needs enhancement |
| Rework instructions | **PARTIAL** | Action task notes; could be more structured |
| Rework verification plan | **PARTIAL** | Verification action type exists |

### MODULE 5: Material & Supplier Deviation Control → 80% EXISTS

| Requirement | Status | Notes |
|---|---|---|
| Material identification | **EXISTS** | Via item association |
| Specification requirement | **PARTIAL** | Need structured spec reference |
| Supplier name | **EXISTS** | `nonConformanceSupplier` |
| Lot/batch number | **EXISTS** | Via `nonConformanceTrackedEntity` |
| Impacted products | **EXISTS** | Via item + trackedEntity associations |
| Customer approval | **PARTIAL** | Same as Module 4 |

### MODULE 6: Identification & Traceability → 95% EXISTS

| Requirement | Status | Notes |
|---|---|---|
| Serial number linkage | **EXISTS** | `nonConformanceTrackedEntity` |
| Lot/batch linkage | **EXISTS** | `trackedEntity` attributes |
| Work order linkage | **EXISTS** | `nonConformanceJobOperation` |
| Deviation visible from product record | **GAP** | Need to show NCRs on item detail page |

### MODULE 7: Approval & Customer Communication → 70% EXISTS

| Requirement | Status | Notes |
|---|---|---|
| Role-based approvals | **EXISTS** | MRB approval + `approvalRequest` |
| Mandatory comments | **PARTIAL** | Notes field on approval tasks |
| Time-stamped records | **EXISTS** | `completedDate` on approval tasks |
| Customer notification | **PARTIAL** | `Customer Communication` action type exists but no formal customer approval workflow |
| Customer approval status | **GAP** | Need dedicated customer approval tracking |
| Evidence upload | **PARTIAL** | Document upload exists on NCR |

### MODULE 8: Corrective Action & Validation → 80% EXISTS

| Requirement | Status | Notes |
|---|---|---|
| Root cause method/result | **EXISTS** | Investigation tasks (Root Cause Analysis) |
| Corrective action | **EXISTS** | Action tasks (Corrective Action, Preventive Action) |
| Owner & due date | **EXISTS** | `assignee` + `dueDate` on action tasks |
| Validation method/results | **PARTIAL** | Verification action type exists; structured validation needs enhancement |
| Cannot close without validated effectiveness | **GAP** | Need business rule enforcement |

### MODULE 9: Audit & Records Control → 90% EXISTS

| Requirement | Status | Notes |
|---|---|---|
| Change history | **EXISTS** | Audit log system |
| Approval timestamps | **EXISTS** | On approval tasks |
| Searchable records | **EXISTS** | Full-text search on NCR table |
| Exportable reports | **PARTIAL** | PDF generation patterns exist; need NCR-specific export |
| Immutable audit trail | **EXISTS** | Separate audit tables |
| Configurable retention | **EXISTS** | 30-day default with archival |

---

## Part 4: Recommendation - What to Build

### Approach: Extend NCR, Don't Build Parallel System

Based on the analysis above and how all major ERPs handle this, we recommend:

1. **Do NOT create a separate `deviation` table.** Instead, extend the existing `nonConformance` system.
2. **Add deviation-specific fields** to the existing schema.
3. **Enable the disabled disposition values** that are already in the database.
4. **Enhance the approval workflow** to support customer approvals.
5. **Connect gauges to the shop floor** and NCR system.

### What Needs to Be Built (Prioritized)

#### Priority 1: Core Enhancements (Extends Existing NCR)

- [ ] **Enable all disposition values** - Uncomment the disabled dispositions in `quality.models.ts` (Conditional Acceptance, Deviation Accepted, Hold, Quarantine, Repair, Return to Supplier, No Action Required). These are already in the DB enum.
- [ ] **Add deviation-specific fields to NCR** - Add `duration` (temporary/permanent enum), `deviationReasonCode` (link to reason code table), and `customerApprovalRequired` (boolean) to the `nonConformance` table.
- [ ] **Expand status workflow** - Add "Draft" and potentially "Approved"/"Active" states. Currently Registered→In Progress→Closed. Consider: Draft→Registered→In Progress→Closed with Rejected as terminal state.
- [ ] **Add `deviationReasonCode` table** - Simple lookup table for deviation reason codes (configurable per company).
- [ ] **Business rule: Cannot close without validated CAPA** - Add validation that all required action tasks must be "Completed" before NCR status can move to "Closed".
- [ ] **Show NCRs on item detail page** - Add a section on the item detail page showing related nonConformance records.

#### Priority 2: Customer Approval Workflow

- [ ] **Add `nonConformanceCustomerApproval` table** - Track customer approval status (Pending/Approved/Rejected), customer contact, evidence uploads, timestamps.
- [ ] **External customer approval portal** - Leverage existing external link pattern (`nonConformanceSupplier.externalLinkId`) to create a shareable approval link for customers.
- [ ] **Customer approval enforcement** - When `customerApprovalRequired` is true, NCR cannot progress past "In Progress" without customer approval.

#### Priority 3: Gauge-to-Shop Floor Integration

- [ ] **Add gauge selection to MES inspection steps** - When an operation requires inspection, allow operators to select which gauge they're using.
- [ ] **Flag gauge as "Under Deviation"** - Add a status or flag when a gauge calibration record fails.
- [ ] **Auto-link affected operations** - When a gauge is found out-of-calibration, auto-identify operations that used it since last good calibration (via trackedActivity linkage).
- [ ] **Gauge association on NCR** - Add `nonConformanceGauge` junction table to link NCRs to specific gauges.

#### Priority 4: Scrap/Rework to NCR Traceability

- [ ] **Auto-create NCR from MES scrap** - When scrap is recorded on the shop floor, optionally auto-create an NCR linked to the job operation and tracked entity.
- [ ] **Link rework to NCR disposition** - When disposition is "Rework", create a rework action task with instructions that flows to the MES.
- [ ] **Rework verification step** - After rework is complete in MES, require re-inspection before releasing product.

#### Priority 5: Reporting & Export

- [ ] **NCR/Deviation PDF export** - Generate a formal deviation report PDF (leveraging existing PDF generation patterns).
- [ ] **Deviation metrics dashboard** - Count by type, disposition breakdown, average closure time, overdue items.

### What Does NOT Need to Be Built (Already Exists)

- Deviation record & classification → Use `nonConformance` + `nonConformanceType`
- Traceability (serial, lot, work order) → Use existing association tables
- MRB approval workflow → Use existing `nonConformanceApprovalTask` + `nonConformanceReviewer`
- Risk assessment → Use existing `riskRegister` linked to items
- Corrective/Preventive actions → Use existing action tasks
- Containment actions → Already an action type
- Audit trail → Already tracked
- Root cause analysis → Already an investigation type
- Linear/Jira integration for actions → Already built
- Document management → Quality documents already exist
- Material/supplier tracking → Supplier associations already exist

### Brad's Post-Shipment Containment Question

**This can be solved TODAY with existing infrastructure:**
1. Create NCR with affected item(s) and serial/lot range
2. Associate shipment lines for shipped items via `nonConformanceShipmentLine`
3. Associate tracked entities for unshipped items via `nonConformanceTrackedEntity`
4. Create "Containment Action" task for field notification
5. Create "Customer Communication" action task
6. Disposition: "Hold" for unshipped, "Rework"/"Scrap" as appropriate

The one enhancement needed is **batch association** - ability to select a serial number range rather than individual entities. This could be a UI enhancement on the tracked entity association modal.

---

## Part 5: Database Changes Summary

### New Tables

```sql
-- Deviation reason codes (configurable per company)
CREATE TABLE "deviationReasonCode" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN DEFAULT TRUE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id"),
  "createdBy" TEXT REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Customer approval tracking for NCRs
CREATE TABLE "nonConformanceCustomerApproval" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "nonConformanceId" UUID NOT NULL REFERENCES "nonConformance"("id") ON DELETE CASCADE,
  "customerId" TEXT NOT NULL REFERENCES "customer"("id"),
  "status" TEXT NOT NULL DEFAULT 'Pending', -- Pending, Approved, Rejected
  "approvedBy" TEXT, -- customer contact name
  "approvedAt" TIMESTAMP WITH TIME ZONE,
  "notes" JSONB,
  "evidenceUrl" TEXT,
  "companyId" TEXT NOT NULL REFERENCES "company"("id"),
  "createdBy" TEXT REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Gauge association for NCRs
CREATE TABLE "nonConformanceGauge" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "nonConformanceId" UUID NOT NULL REFERENCES "nonConformance"("id") ON DELETE CASCADE,
  "gaugeId" UUID NOT NULL REFERENCES "gauge"("id"),
  "companyId" TEXT NOT NULL REFERENCES "company"("id"),
  "createdBy" TEXT REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Altered Tables

```sql
-- Add deviation-specific fields to nonConformance
ALTER TABLE "nonConformance" ADD COLUMN "duration" TEXT; -- 'Temporary' | 'Permanent'
ALTER TABLE "nonConformance" ADD COLUMN "deviationReasonCodeId" UUID REFERENCES "deviationReasonCode"("id");
ALTER TABLE "nonConformance" ADD COLUMN "customerApprovalRequired" BOOLEAN DEFAULT FALSE;
```

### Enum Changes

```sql
-- Expand nonConformanceStatus to include Draft
ALTER TYPE "nonConformanceStatus" ADD VALUE 'Draft' BEFORE 'Registered';
```

### Model Changes (TypeScript)

```typescript
// Enable all disposition values
export const disposition = [
  "Conditional Acceptance",
  "Deviation Accepted",
  "Hold",
  "No Action Required",
  "Pending",
  "Quarantine",
  "Repair",
  "Return to Supplier",
  "Rework",
  "Scrap",
  "Use As Is"
] as const;
```

---

## Part 6: Mapping Emiliano's Modules to Implementation

| Emiliano's Module | Implementation | Effort |
|---|---|---|
| MODULE 1: Core Framework | Extend `nonConformance` + add reason codes | Small |
| MODULE 2: Tool & Gauge | Connect existing gauge system to NCR + MES | Medium |
| MODULE 3: Document Deviation | Use NCR + qualityDocument linkage | Small |
| MODULE 4: Nonconforming Product | Enable all dispositions + customer approval | Small-Medium |
| MODULE 5: Material & Supplier | Already exists via NCR associations | Minimal |
| MODULE 6: Traceability | Already exists; add NCR view on item page | Small |
| MODULE 7: Approval & Customer | Enhance approval workflow + customer portal | Medium |
| MODULE 8: CAPA | Enhance closure validation | Small |
| MODULE 9: Audit & Reporting | Add PDF export + metrics | Medium |

---

## Review

### Decisions Needed

1. **Should we add "Draft" status to NCR?** This changes the existing workflow. Currently NCRs start as "Registered". Adding Draft means users can save incomplete NCRs. This is useful for deviations but changes behavior for existing NCR users.

2. **Should we rename "Issues" to "Deviations" in the UI?** Brad called this a "submodule" of quality. We could add a "Deviations" view that filters NCRs by type, or rename the whole thing.

3. **Should gauge-to-shop-floor integration be part of this scope?** Brad mentioned it's a separate concern but related. Could be Phase 2.

4. **Should the customer approval portal be built?** This is significant work (external-facing page). Could start with internal tracking of customer approval status and add the portal later.

5. **What about the "welcomed screen" logo navigation issue?** Emiliano mentioned this - is it in scope for this work?
