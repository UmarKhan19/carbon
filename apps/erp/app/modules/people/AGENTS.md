# People Module

Employee management, departments, shifts, holidays, time tracking (clock in/out, timecards), contacts, employee attributes (custom fields), and the people directory. This module manages the HR/organizational side — identity and permissions live in the `users` module.

## Key Domain Concepts

- **People vs Users vs Employees** — `user` is the global identity (auth). `employee` is a per-company record (`(id, companyId)` composite PK where `id → user.id`). `employeeJob` holds the job title, location, department, shift, and manager. See `.claude/rules/user-employee-job-relationships.md`.
- **Departments** — hierarchical organizational units via `parentDepartmentId`. Used for org structure and reporting.
- **Shifts** — work schedules with day-of-week flags, start/end times, and location. Assigned to employees via `employeeJob.shiftId`.
- **Holidays** — company-specific non-working days.
- **Time Tracking** — clock in/out with `clockIn`/`clockOut` functions. Timecards record entries with optional notes. Weekly hours aggregation available.
- **Contacts** — external contacts (not employees) associated with customers/suppliers.
- **Employee Attributes** — custom field system: categories contain attributes, each with a data type (text, numeric, boolean, date, user, file, list). Values stored per user in `userAttributeValue`.

## Safety

### Always
- Scope `employee` and `employeeJob` queries by BOTH `id` AND `companyId` — composite PK.
- Distinguish `employeeJob.title` (job role) from `userToCompany.role` (membership type enum: customer/employee/supplier).
- Use `getEmployeeJob` to read employee's current job info — it joins the right tables.
- Remember that deactivating an employee (in users module) cascades: removes permissions, deletes `userToCompany` and `employeeJob` rows.

### Ask First
- Deleting departments that have employees assigned.
- Modifying shifts that are actively assigned to employees.
- Bulk-editing employee attributes.

### Never
- Confuse `employeeJob` (HR job title/org placement) with `job` (production work order) — completely different tables.
- Directly modify `userPermission` — permissions flow from `employeeType → employeeTypePermission → userPermission`.
- Delete attribute categories or attributes — soft-delete via `active: false`.

## Key Data Model

| Table / View | Purpose |
|---|---|
| `employee` | Per-company employee record: `(id, companyId)`, employeeTypeId, active, pin |
| `employeeJob` | Job details: title, startDate, locationId, departmentId, shiftId, managerId |
| `department` | Org units with `parentDepartmentId` hierarchy |
| `shift` | Work schedules: days, times, location |
| `holiday` | Company non-working days |
| `userAttributeCategory` / `userAttribute` / `userAttributeValue` | Custom employee fields |
| `clockEntry` | Time tracking: clock in/out with notes |
| `employees` (view) | Joins user + employee + job with computed `status` |
| `employeeSummary` (view) | Denormalized employee info with names |

## Key Service Functions

- `getEmployeeJob` — reads employee's job info (title, location, department, manager)
- `getEmployeeSummary` — denormalized employee data from the view
- `getPeople` — people directory with search/filter
- `getContacts` — external contacts
- `getDepartments`, `getDepartmentsList`, `getDepartmentsTree` — org structure
- `getShifts`, `getShiftsList` — work schedule management
- `getHolidays`, `getHolidayYears` — holiday calendar
- `clockIn`, `clockOut`, `getTimeCardEntries`, `getWeeklyHoursForEmployees` — time tracking
- `getAttribute`, `getAttributeCategories`, `insertAttribute` — custom fields
- `getScheduledEmployeesToday` — shift-based scheduling

## Related Modules

- **resources** — locations, shifts (also managed here), work centers assign employees
- **production** — job operations have `assignee` (employee); production events track employee time
- **users** — identity, permissions, and claims (separate module, not people)
- **sales** — customer contacts overlap; `accountManagerId` on customers
- **purchasing** — supplier contacts managed separately

## Rules References

- `.claude/rules/user-employee-job-relationships.md` — complete identity graph: user → employee → employeeJob → permissions
