# Resources Module

Locations, work centers, processes, abilities (skills), partners, contractors, equipment maintenance (dispatches and schedules), failure modes, training management, and employee suggestions. Manages the physical and capability infrastructure that production and other modules depend on.

## Key Domain Concepts

- **Locations** — physical sites/facilities. Every inventory, job, and employee is scoped to a location. Has address, timezone, and GPS coordinates.
- **Work Centers** — production stations within a location. Operations are scheduled onto work centers. Have capacity settings, rates, and active/inactive status. Soft-deleted via `active: false`.
- **Processes** — types of work (e.g., "CNC Milling", "Welding", "Anodizing"). Operations reference a process. Active/inactive. Types defined by `processType` enum.
- **Abilities** — employee skills/certifications with learning curves. Tracked per employee via `employeeAbility` with training status and completion percentage.
- **Partners** — external partners associated with the company.
- **Contractors** — supplier contacts working as contract labor, with hours-per-week and ability assignments.
- **Maintenance Dispatches** — reactive/scheduled work orders for equipment. Statuses: Open → Assigned → In Progress → Completed/Cancelled. Track time (events), parts used (items), and affected work centers.
- **Maintenance Schedules** — preventive maintenance plans with frequency (Daily/Weekly/Monthly/Quarterly/Annual), priority, and required parts.
- **Failure Modes** — categorized failure types (Maintenance/Quality/Operations/Other) used by both maintenance and quality modules.
- **Training** — training programs with assignments, quizzes, and completion tracking. Frequency-based recertification.
- **Suggestions** — employee suggestion box system.

## Safety

### Always
- Soft-delete work centers (`active: false`) — they may be referenced by job operations and schedules.
- Soft-delete processes (`active: false`) via `processDeactivate` — they're referenced by operations and procedures.
- Scope by `companyId` on all queries; locations are company-scoped.
- Check `isMaintenanceDispatchLocked(status)` before editing — Completed/Cancelled dispatches are locked.

### Ask First
- Deleting locations — cascading impact on inventory, jobs, employees, and storage units.
- Deactivating work centers that have active job operations scheduled.
- Modifying process definitions that are referenced by active methods or procedures.

### Never
- Hard-delete work centers or processes — always soft-delete via `active: false`.
- Delete locations that have inventory or active jobs.
- Remove abilities that have employee training records.

## Key Data Model

| Table / View | Purpose |
|---|---|
| `location` | Physical sites: address, timezone, coordinates |
| `workCenter` | Production stations: location, capacity, rates, active flag |
| `process` | Work types: name, type, active flag |
| `ability` / `employeeAbility` | Skills with learning curves and training tracking |
| `partner` | External partners |
| `contractor` | Contract labor: supplier contact, hours, abilities |
| `maintenanceDispatch` | Equipment work orders: status, priority, severity, OEE impact |
| `maintenanceDispatchEvent` / `maintenanceDispatchComment` / `maintenanceDispatchItem` | Dispatch details |
| `maintenanceSchedule` / `maintenanceScheduleItem` | Preventive maintenance plans |
| `maintenanceFailureMode` | Failure categories (shared with quality) |
| `training` / `trainingAssignment` / `trainingQuestion` | Training programs and quizzes |
| `suggestion` | Employee suggestions |

## Key Service Functions

- `getLocations`, `getLocationsList` — site management
- `getWorkCenters`, `activateWorkCenter`, `deleteWorkCenter` (soft) — work center management
- `getProcesses`, `getProcessesList`, `activateProcess`, `processDeactivate`
- `getAbilities`, `getAbility`, `getEmployeeAbilities` — skill tracking
- `getPartners`, `getContractors` — external resources
- `getMaintenanceDispatch(es)`, `getMaintenanceDispatchEvents/Comments/Items` — dispatch management
- `getMaintenanceSchedule(s)`, `getMaintenanceScheduleItems` — PM plans
- `getFailureModes`, `getFailureModesList` — failure categorization
- `getTraining(s)`, `getTrainingAssignment(s)`, `getOutstandingTrainingsForUser`
- `getSuggestion(s)` — suggestion management

## Related Modules

- **production** — job operations run on work centers; scheduling assigns to work centers; processes link operations to capabilities; maintenance dispatches track machine downtime
- **inventory** — storage units exist within locations; inventory is location-scoped
- **people** — employees have abilities; shifts are location-scoped; contractors are supplier contacts
- **quality** — failure modes shared between maintenance and quality NCRs
- **items** — maintenance dispatches consume items (spare parts); supplier processes link processes to suppliers
- **purchasing** — contractors reference supplier contacts
