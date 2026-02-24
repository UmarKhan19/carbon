# Deviation Management - Scope Analysis & Implementation Plan

## Executive Summary

This document analyzes what Carbon already has, how SAP/major ERPs handle deviation management, what Emiliano's proposal covers, and provides a recommendation for what needs to be built new vs. what can leverage existing infrastructure.

**Key Finding:** Carbon's existing NCR (Issue) module already covers ~60-70% of the deviation management requirements. The core question is whether "Deviation" should be a separate entity or an extension of the existing nonConformance system. Our recommendation is to **extend the existing NCR system** rather than build a parallel system.

---

## Part 1: How SAP & Major ERPs Handle Deviations

### SAP QM (Quality Management)

SAP QM is structured around three pillars: **Quality Planning**, **Quality Inspection**, and **Quality Notification**. Deviation management lives primarily in the Quality Notification and Quality Inspection subsystems.

SAP uses **Quality Notifications** as the central mechanism for deviations:

**Q-Type (Manually Created):**

| SAP Notification Type | Purpose | Carbon Equivalent |
|---|---|---|
| **Q1 - Customer Complaint** | Customer reports a quality issue with delivered product | NCR with source="External", customer association |
| **Q2 - Complaint Against Vendor** | Quality issue found in received materials (incoming inspection) | NCR with source="External", supplier association |
| **Q3 - Internal Problem Report** | Quality issue found during in-process inspection on the shop floor | NCR with source="Internal", job operation association |

**F-Type (Created During Inspection - automatically generated):**

| SAP Notification Type | Purpose | Carbon Equivalent |
|---|---|---|
| **F1 - Customer-related Defect** | Defect recorded during inspection linked to customer context | Auto-NCR from inspection |
| **F2 - Supplier-related Defect** | Defect recorded during incoming goods inspection | Auto-NCR from receipt inspection |
| **F3 - Material-related Defect** | Defect recorded during production inspection | Auto-NCR from MES scrap/inspection |

Custom types are common: **Deviation Acceptance Report (DAR)** for formal concession requests, **CAPA Notification** for corrective/preventive action tracking.

**SAP Quality Notification Structure:**
- **Header**: Problem description, reference objects (material, batch, order), quantities, status
- **Items**: Coded defects (defect type + defect location)
- **Causes**: Root cause codes linked to items
- **Tasks**: Corrective actions with responsible parties, deadlines, status
- **Activities**: Documented actions taken during processing
- **Partners**: Internal and external parties involved

**SAP's Deviation Flow:**
1. **Detection** - Quality notification created (shop floor, inspection, receiving)
2. **Classification** - Categorized by type, coded with reason/defect codes
3. **Disposition (Usage Decision)** - Formal decision about material fate with coded options, triggers stock movements
4. **Approval** - Multi-level workflow routing to internal approvers, engineering, customer
5. **Corrective Action** - CAPA linked to notification, root cause analysis (8D methodology supported in S/4HANA 1909+)
6. **Closure** - Verified effectiveness, audit trail complete

**SAP Usage Decision Codes (Disposition):**

| Code | Meaning | Stock Action |
|---|---|---|
| Accept | Material meets specs | Move to unrestricted stock |
| Accept with minor deviations | Acceptable with noted issues | Move to unrestricted stock (documented) |
| Reject - Rework | Fixable nonconformance | Move to rework area / create rework order |
| Reject - Scrap | Unsalvageable | Post to scrap (removed from inventory) |
| Reject - Return to Vendor | Supplier issue | Create return delivery |
| Reject - Block | Pending further decision | Move to blocked stock (MRB hold) |

**SAP's key distinction:** SAP does NOT have a separate "Deviation" module. Deviations are handled through Quality Notifications + Usage Decisions + CAPA. The term "deviation" in SAP refers to a concession/waiver request, which is a specific disposition type within the notification workflow.

**Key SAP concepts for Carbon:**
- **Concession** = Permission to use/ship product that is already produced and nonconforming (post-production). Customer approves accepting the nonconforming product.
- **Deviation Permit** = Permission to depart from requirements *before* production. Approved for a limited quantity or time period.
- **MRB** = Implemented through blocked stock + quality notifications as the MRB queue + workflow routing to MRB members. No dedicated "MRB" entity.

### Oracle Quality Management
- Nonconformances logged dynamically during batch execution with **severity, priority, and ownership**
- Tracks deviations caused by: batch material quantity changes, item substitutions, resource substitutions, ad-hoc operator observations
- **Workflow approval process** for disposition decisions
- Operators, supervisors, and quality managers can all log nonconformances
- Full electronic records with auditable trail (identity, date/time, reason for signing)
- Oracle MES integrates directly with Oracle Quality for shop floor transaction reporting

### Epicor (Kinetic)
- **Two-stage nonconformance flow**: NCR -> DMR (Discrepant Material Report)
- When parts fail inspection, a DMR is automatically created, providing the MRB with an online queue
- **Four standard dispositions**: Scrap, Rework In-House, Rework at Vendor, Use As Is
- "Use As Is" often requires engineering analysis or customer approval
- Corrective actions tracked with due dates, audit sign-offs
- **Tiered QMS**: Basic (built-in), Enhanced QA, Advanced QMS (powered by ETQ with 40+ quality apps)

### DELMIAworks (formerly IQMS)
- **Single-database architecture**: Quality, ERP, and MES all in one system (like Carbon!)
- Non-conforming inventory tracked in the same database as manufacturing, accounting, and supply chain
- Quality modules link directly to RMAs, BOMs, and all manufacturing data
- **Corrective Action Requests (CARs)** with scheduling, assignment, and tracking
- ISO and FDA compliance tracking built in

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

SAP handles this through a **multi-module containment workflow**:
1. **Identify scope** - Batch Cockpit (BMBC) traces from defective batch to all deliveries and customers. MB56 (Batch Where-Used) identifies all downstream consumption.
2. **Create notifications** - Q1 notification created for each affected customer; Q3 for internal containment
3. **Quarantine remaining inventory** - Transfer stock postings to move remaining material from unrestricted to blocked stock or dedicated containment location
4. **Distribution halt** - Block material/batch for further shipments
5. **Customer notification & resolution** - Return material authorization (RMA), replacement shipments, credit notes
6. **CAPA** - Corrective action tasks in the quality notification

**Key SAP limitation:** SAP does not have a dedicated "recall campaign" entity in standard QM. Recall campaigns are managed through multiple Q1 notifications + PLM documentation. Industries like automotive/medical devices often need custom development for formal field action campaigns.

**Carbon can handle this today** via the existing NCR + trackedEntity + shipmentLine associations. The NCR already supports linking to shipment lines and tracked entities, which enables identification of shipped vs. unshipped affected items. Carbon's single-database architecture (like DELMIAworks) is actually an advantage here -- the traceability graph can instantly show which tracked entities were shipped where.

---

### Deviation Types to Support (Universal Across ERPs)

Based on the research, these are the deviation categories all major ERPs converge on:

| Type | Description | Carbon Mapping |
|---|---|---|
| **Unplanned deviation** | Nonconformance discovered during inspection/production | Standard NCR |
| **Planned deviation / Deviation permit** | Pre-approved departure from spec (time/quantity-limited) | NCR with duration="Temporary" |
| **Concession** | Post-production approval to use/ship nonconforming product | NCR with disposition="Deviation Accepted" + customer approval |
| **In-process exception** | Real-time deviation reported from shop floor | NCR created from MES |

### Universal Disposition Options (All ERPs agree on these)

1. **Accept / Use As Is** - Product meets functional requirements despite measured deviation
2. **Rework** - Return product to conformance through additional processing
3. **Repair** - Make product acceptable without fully returning to original spec (requires concession)
4. **Scrap** - Destroy/discard the product
5. **Return to Vendor** - Send nonconforming purchased material back to supplier
6. **Hold / Quarantine** - Segregate pending further decision (MRB queue)
7. **Conditional Acceptance** - Accepted with conditions/limitations
8. **Regrade / No Action Required** - Use for different purpose or determined to be within acceptable range

Note: Carbon's database already has all these as the `disposition` enum! They're just commented out in the TypeScript model.

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
