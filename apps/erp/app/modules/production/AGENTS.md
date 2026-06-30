# Production Module

Work orders (jobs), scheduling, routings (operations), bill of materials, procedures, production events/quantities, maintenance dispatches/schedules, demand forecasting, and MRP integration.

## Key Domain Concepts

- **Jobs** — production work orders. Statuses: Draft → Planned → Ready → In Progress → Paused → Completed → Closed/Cancelled. A job has an `itemId` (what to make), quantity, location, and due date.
- **Job Make Methods** — a job's manufacturing method (BOM + routing). Root method has `parentMaterialId = null`; sub-assemblies nest via `parentMaterialId`. Created by the `get-method` edge function.
- **Job Operations** — routing steps within a make method. Ordered by `order` column. Types: Inside (in-house) or Outside (subcontracted). Statuses: Todo → Ready → In Progress → Done.
- **Job Materials** — BOM lines within a make method. Each has a `methodType` (Pull from Inventory, Purchase to Order, Make to Order) that drives procurement.
- **Procedures** — versioned work instructions linked to operations via `processId`.
- **Production Events** — time tracking (Labor/Machine/Setup) against operations.
- **Production Quantities** — output recording (Production/Scrap/Rework) against operations.
- **Scheduling** — infinite-capacity backward scheduling engine (edge function `schedule`). See `.ai/rules/scheduling-data-structures.md`.
- **Maintenance** — dispatches (reactive/scheduled repairs) and schedules (preventive maintenance) for work centers.

## Safety

### Always
- Use `recalculateJobRequirements` after changing job materials or operations — it recalculates quantities and costs.
- Use `triggerJobSchedule` to reschedule (not direct date writes) — it invokes the scheduling engine.
- Check `isJobLocked(status)` before allowing edits — Completed/Closed/Cancelled jobs are locked.
- Scope queries by `companyId`; jobs are also scoped by `locationId`.

### Ask First
- Deleting jobs that have posted production events or inventory movements.
- Changing job status backwards (e.g., Completed → In Progress).
- Running MRP (`runMRP`) — it can create/modify planned orders across the system.

### Never
- Directly modify `jobOperation.startDate`/`dueDate` without going through the scheduling engine.
- Delete job operations that have production events recorded against them.
- Set `job.priority` manually — it's calculated by `calculateJobPriority` based on deadline type and due date.

## Key Data Model

| Table / View | Purpose |
|---|---|
| `job` / `jobs` (view) | Work order header: item, quantity, dates, status, priority |
| `jobMakeMethod` | Manufacturing method instance; tree via `parentMaterialId` |
| `jobOperation` | Routing step: process, times, work center, status, scheduling dates |
| `jobMaterial` | BOM line: item, quantity, method type, unit cost |
| `jobOperationStep` / `jobOperationParameter` / `jobOperationTool` | Work instruction details |
| `productionEvent` | Time tracking: type (Labor/Machine/Setup), start/end, employee |
| `productionQuantity` | Output: type (Production/Scrap/Rework), quantity, scrap reason |
| `procedure` / `procedureStep` / `procedureParameter` | Versioned work instructions |
| `maintenanceDispatch` / `maintenanceSchedule` | Equipment maintenance tracking |
| `demandForecast` / `demandProjection` | Demand planning data |
| `scrapReason` / `maintenanceFailureMode` | Reference data |

## Key Service Functions

- `convertSalesOrderLinesToJobs` — creates jobs from sales order (Make to Order lines)
- `getJob`, `getJobs`, `getJobMethodTree`, `getJobMaterialsWithQuantityOnHand`
- `getJobOrderStatusMap` — procurement status indicators per material
- `getJobMaterialShortfallByItem` — priority-adjusted shortfall calculation
- `recalculateJobRequirements`, `recalculateJobOperationDependencies`
- `triggerJobSchedule` — fires the scheduling engine via Inngest
- `runMRP` — triggers Material Requirements Planning
- `calculateJobPriority` — computes priority from deadline type
- `getActiveJobOperationsByLocation` — schedule board data (RPC)
- `getJobsByDateRange`, `getUnscheduledJobs` — date board data

## Related Modules

- **sales** — jobs are created from sales order lines; `job.salesOrderLineId` links back
- **items** — `job.itemId` references item master; methods come from item's make methods
- **inventory** — materials are issued from inventory; finished goods post to inventory on completion
- **purchasing** — outside operations and purchased materials create PO lines
- **resources** — operations run on work centers; scheduling assigns to work centers
- **quality** — production quantities can trigger quality inspections

## Rules References

- `.ai/rules/scheduling-data-structures.md` — scheduling engine architecture, RPCs, trigger chain
- `.ai/rules/method-material-sourcing.md` — how material sourcing types work
