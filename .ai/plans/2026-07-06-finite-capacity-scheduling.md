# Finite Capacity Scheduling (Phases 1–4) — implementation plan

**Spec:** .ai/specs/2026-07-05-finite-capacity-scheduling.md (open questions resolved 2026-07-06)
**Branch:** naveen/capacity-planning

Scope: spec rollout phases 1–4 only — (1) master data/calendars, (2) capability
model, (3) finite DRC scheduler core, (4) dynamic lead time. Phases 5–8 (Gantt
board, capacity lens on planning, scenario engine, training→ability bridge,
fast-follows) are **explicitly out of scope** — do not build any part of them.

Ground rules for every task (from AGENTS.md + rules — do not deviate):

- `pnpm`, never `npm`. Migrations created with `pnpm db:migrate:new <name>` —
  never hand-pick a timestamp; the newest existing migration is
  `20260702224219_fix-ar-ap-legacy-paid.sql`, so generated timestamps are safe.
- Every new table: `id('prefix')` PK default, `companyId TEXT NOT NULL`,
  composite `PRIMARY KEY ("id", "companyId")`, FK to `"company"("id") ON DELETE
  CASCADE`, audit columns (`createdBy` NOT NULL + `createdAt` + `updatedBy` +
  `updatedAt`, `*By` referencing `"user"("id")` inline), indexes on `companyId`
  and every FK, RLS with exactly four policies named `SELECT`/`INSERT`/`UPDATE`/
  `DELETE` (SELECT via `get_companies_with_employee_role()`, writes via
  `get_companies_with_employee_permission('<module>_<action>')`). Bare `NUMERIC`
  (no precision). No generic `updatedAt` trigger.
- Whole-repo typecheck OOMs — only `pnpm exec turbo run typecheck --filter=<pkg>`.
- Never rebuild the database. Applying pending migrations with `pnpm db:migrate`
  is allowed and expected.
- Backfill rows use `'system'` as `createdBy`. Before first use, verify a
  `'system'` user exists: `grep -rn "'system'" packages/database/supabase/migrations | head -5`
  should show prior migrations doing the same. If none do, STOP and report.

## Progress

- [x] Task 1: Migration — resource calendars, work-center capacity fields, time-phased capacity, backfill
- [x] Task 2: Calendar models + service functions (resources module)
- [x] Task 3: Resource calendar CRUD UI
- [x] Task 4: Work center form — capacity/calendar fields (follow-up migration 20260705220323 recreated workCenters + workCentersWithBlockingStatus views for the new columns)
- [x] Task 5: Time-phased capacity editor on work center
- [x] Task 6: Migration — ability requirements, eligibility columns
- [x] Task 7: Ability-requirement models + services + shared proficiency util
- [x] Task 8: Copy method abilities → job abilities in get-method + rework (quote-sourced branch skipped with comment — no quoteOperationAbility table)
- [x] Task 9: Required-abilities field on method + job operation editors
- [x] Task 10: Abilities admin UI (list + form, expiry fields)
- [x] Task 11: Skills matrix UI (person × ability grid) — SUPERSEDED 2026-07-06 by user decision: matrix removed in favor of ability-scoped rosters + editable person panel; training→ability bridge (spec phase 7) pulled into scope (migration 20260706112951, trigger verified)
- [x] Task 12: MES eligibility lockout on operation start (gate in start.$operationId loader; fail-open on infra errors)
- [x] Task 13: Migration — capacity reservations + scheduling policy
- [x] Task 14: Scheduler refactor — MasterDataProvider seam (note: `deno check schedule/index.ts` fails with 18 PRE-EXISTING errors, identical at HEAD baseline — no new errors introduced)
- [x] Task 15: Calendar expansion + slot-walking utilities (pure, with Deno tests — 12 passing)
- [x] Task 16: Finite slot allocator — machine capacity (10 tests passing)
- [x] Task 17: Operator-pool DRC + dispatch policy (finite context built in selectWorkCenters, not initialize — dependencies are rebuilt between phases)
- [x] Task 18: Engine wiring — reservation lifecycle + conflict persistence (live smoke deferred to Task 23 — local DB broken by interrupted prod restore)
- [x] Task 19: Migration — readyAt, queue-time view, utilization table
- [x] Task 20: Promise-date service (predictLeadTime v1)
- [x] Task 21: Inngest utilization rollup cron
- [x] Task 22: Docs sync (AGENTS.md + spec changelog)
- [ ] Task 23: Browser verification via /test

## Dependencies

- Task 2 needs 1 (types). Tasks 3, 4, 5 need 2; 3/4/5 are independent of each other.
- Task 7 needs 6. Tasks 8, 9, 10, 11, 12 need 7; 8–12 are independent of each other.
- Tasks 13, 14, 15 are independent of each other (14 and 15 need nothing but code).
- Task 16 needs 1, 13, 14, 15. Task 17 needs 6, 16. Task 18 needs 16, 17.
- Task 19 is independent. Task 20 needs nothing beyond existing schema (uses `jobOperation.dueDate`). Task 21 needs 13, 19.
- Tasks 22, 23 last. 23 needs a running dev stack — ask the user to start it if not up.

---

## Task 1: Migration — resource calendars, work-center capacity fields, time-phased capacity, backfill

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<generated>_resource-calendars.sql` (via `pnpm db:migrate:new resource-calendars`)
- Copy from (precedent): `packages/database/supabase/migrations/20260609143732_document-template.sql` (table + RLS shape)

**Steps:**

1. `pnpm db:migrate:new resource-calendars`
2. Write this SQL (adjust nothing except honest syntax fixes):

```sql
-- Enums
CREATE TYPE "workCenterSchedulingMode" AS ENUM ('Finite', 'Infinite');
CREATE TYPE "resourceCalendarExceptionType" AS ENUM ('Closed', 'Open', 'ReducedCapacity');

-- Named working-time calendar, assignable to work centers
CREATE TABLE "resourceCalendar" (
    "id" TEXT NOT NULL DEFAULT id('rcal'),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT REFERENCES "location"("id") ON DELETE SET NULL,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE INDEX "resourceCalendar_companyId_idx" ON "resourceCalendar" ("companyId");
CREATE INDEX "resourceCalendar_locationId_idx" ON "resourceCalendar" ("locationId");
CREATE INDEX "resourceCalendar_createdBy_idx" ON "resourceCalendar" ("createdBy");
ALTER TABLE "resourceCalendar" ADD CONSTRAINT "resourceCalendar_companyId_name_key"
    UNIQUE ("companyId", "name");

-- Recurring weekly pattern; multiple rows per day = split shifts
CREATE TABLE "resourceCalendarShift" (
    "id" TEXT NOT NULL DEFAULT id('rcsh'),
    "companyId" TEXT NOT NULL,
    "resourceCalendarId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL CHECK ("dayOfWeek" BETWEEN 0 AND 6), -- 0 = Sunday
    "startTime" TIME NOT NULL,
    "endTime" TIME NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("resourceCalendarId", "companyId")
        REFERENCES "resourceCalendar"("id", "companyId") ON DELETE CASCADE
);
CREATE INDEX "resourceCalendarShift_companyId_idx" ON "resourceCalendarShift" ("companyId");
CREATE INDEX "resourceCalendarShift_resourceCalendarId_idx" ON "resourceCalendarShift" ("resourceCalendarId");
CREATE INDEX "resourceCalendarShift_createdBy_idx" ON "resourceCalendarShift" ("createdBy");

-- One-off exceptions: holidays, maintenance windows, overtime
CREATE TABLE "resourceCalendarException" (
    "id" TEXT NOT NULL DEFAULT id('rcex'),
    "companyId" TEXT NOT NULL,
    "resourceCalendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "type" "resourceCalendarExceptionType" NOT NULL DEFAULT 'Closed',
    "capacityOverride" NUMERIC, -- only meaningful for 'ReducedCapacity'
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("resourceCalendarId", "companyId")
        REFERENCES "resourceCalendar"("id", "companyId") ON DELETE CASCADE,
    CHECK ("endAt" > "startAt")
);
CREATE INDEX "resourceCalendarException_companyId_idx" ON "resourceCalendarException" ("companyId");
CREATE INDEX "resourceCalendarException_resourceCalendarId_idx" ON "resourceCalendarException" ("resourceCalendarId");
CREATE INDEX "resourceCalendarException_createdBy_idx" ON "resourceCalendarException" ("createdBy");

-- Work center capacity fields
ALTER TABLE "workCenter"
    ADD COLUMN "parallelCapacity" INTEGER NOT NULL DEFAULT 1 CHECK ("parallelCapacity" >= 1),
    ADD COLUMN "resourceCalendarId" TEXT,
    ADD COLUMN "efficiencyFactor" NUMERIC NOT NULL DEFAULT 1.0 CHECK ("efficiencyFactor" > 0),
    ADD COLUMN "schedulingMode" "workCenterSchedulingMode" NOT NULL DEFAULT 'Finite';
ALTER TABLE "workCenter" ADD CONSTRAINT "workCenter_resourceCalendarId_fkey"
    FOREIGN KEY ("resourceCalendarId", "companyId")
    REFERENCES "resourceCalendar"("id", "companyId") ON DELETE SET NULL;
CREATE INDEX "workCenter_resourceCalendarId_idx" ON "workCenter" ("resourceCalendarId");

-- Time-phased capacity overrides (resolution: row covering date → workCenter.parallelCapacity)
CREATE TABLE "workCenterCapacity" (
    "id" TEXT NOT NULL DEFAULT id('wcc'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE, -- null = open-ended
    "parallelCapacity" INTEGER NOT NULL CHECK ("parallelCapacity" >= 0),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);
CREATE INDEX "workCenterCapacity_companyId_idx" ON "workCenterCapacity" ("companyId");
CREATE INDEX "workCenterCapacity_workCenterId_idx" ON "workCenterCapacity" ("workCenterId");
CREATE INDEX "workCenterCapacity_createdBy_idx" ON "workCenterCapacity" ("createdBy");
```

3. RLS for all four new tables — the calendar is a resources-module concept, so
   the scope is `resources_*`. Repeat this block for `resourceCalendar`,
   `resourceCalendarShift`, `resourceCalendarException`, `workCenterCapacity`:

```sql
ALTER TABLE "public"."resourceCalendar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "public"."resourceCalendar" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
CREATE POLICY "INSERT" ON "public"."resourceCalendar" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_create'))::text[])
);
CREATE POLICY "UPDATE" ON "public"."resourceCalendar" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_update'))::text[])
);
CREATE POLICY "DELETE" ON "public"."resourceCalendar" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('resources_delete'))::text[])
);
```

4. Backfill — one calendar per active `shift` (shift weekday booleans →
   `resourceCalendarShift` rows) and one `Closed` exception per future `holiday`
   per calendar in the same company:

```sql
DO $$
DECLARE
  s RECORD;
  cal_id TEXT;
BEGIN
  FOR s IN SELECT * FROM "shift" WHERE "active" = TRUE LOOP
    INSERT INTO "resourceCalendar" ("companyId", "name", "locationId", "createdBy")
    VALUES (s."companyId", s."name", s."locationId", 'system')
    ON CONFLICT ("companyId", "name") DO NOTHING
    RETURNING "id" INTO cal_id;
    IF cal_id IS NULL THEN CONTINUE; END IF;
    IF s."sunday"    THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 0, s."startTime", s."endTime", 'system'); END IF;
    IF s."monday"    THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 1, s."startTime", s."endTime", 'system'); END IF;
    IF s."tuesday"   THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 2, s."startTime", s."endTime", 'system'); END IF;
    IF s."wednesday" THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 3, s."startTime", s."endTime", 'system'); END IF;
    IF s."thursday"  THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 4, s."startTime", s."endTime", 'system'); END IF;
    IF s."friday"    THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 5, s."startTime", s."endTime", 'system'); END IF;
    IF s."saturday"  THEN INSERT INTO "resourceCalendarShift" ("companyId","resourceCalendarId","dayOfWeek","startTime","endTime","createdBy") VALUES (s."companyId", cal_id, 6, s."startTime", s."endTime", 'system'); END IF;
  END LOOP;
END $$;

INSERT INTO "resourceCalendarException"
  ("companyId", "resourceCalendarId", "name", "startAt", "endAt", "type", "createdBy")
SELECT h."companyId", rc."id", h."name",
       h."date"::timestamptz, (h."date" + 1)::timestamptz, 'Closed', 'system'
FROM "holiday" h
JOIN "resourceCalendar" rc ON rc."companyId" = h."companyId"
WHERE h."date" >= CURRENT_DATE;
```

   Note: exception times use server timezone for the day boundary — acceptable
   for v1 (whole-day closure); do not add per-location timezone conversion here.
   Do **not** backfill `workCenter.resourceCalendarId` — null means "fall back
   to the location's calendars" (engine behavior, Task 15/16).

5. Apply: `pnpm db:migrate`. Then `pnpm run generate:types` (harmless if
   db:migrate already regenerated).

**Verify:**
```bash
pnpm db:migrate
# Expected: applies <timestamp>_resource-calendars.sql with no error
git diff --stat -- packages/database/src | cat
# Expected: generated type files changed (resourceCalendar, workCenterCapacity present)
```

**Out of scope:** person-level calendars (spec defers them), `scenarioId`
anywhere, any UI, `shift`/`holiday` table changes (they stay; calendars are
derived from them once).

---

## Task 2: Calendar models + service functions (resources module)

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/resources/resources.models.ts` — add validators
- Modify: `apps/erp/app/modules/resources/resources.service.ts` — add service functions
- Modify: `apps/erp/app/modules/resources/index.ts` — barrel re-export (only if models/services are not already wildcard-exported — check first)
- Copy from (precedent): `workCenterValidator` (resources.models.ts:479) and `getWorkCenters`/`upsertWorkCenter`/`deleteWorkCenter` in resources.service.ts

**Steps:**

1. Add to `resources.models.ts`:

```typescript
export const resourceCalendarValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  locationId: zfd.text(z.string().optional()),
});

export const resourceCalendarShiftValidator = z.object({
  id: zfd.text(z.string().optional()),
  resourceCalendarId: z.string().min(1),
  dayOfWeek: zfd.numeric(z.number().int().min(0).max(6)),
  startTime: z.string().min(1, { message: "Start time is required" }),
  endTime: z.string().min(1, { message: "End time is required" }),
});

export const resourceCalendarExceptionValidator = z.object({
  id: zfd.text(z.string().optional()),
  resourceCalendarId: z.string().min(1),
  name: z.string().min(1, { message: "Name is required" }),
  startAt: z.string().min(1, { message: "Start is required" }),
  endAt: z.string().min(1, { message: "End is required" }),
  type: z.enum(["Closed", "Open", "ReducedCapacity"]),
  capacityOverride: zfd.numeric(z.number().optional()),
});

export const workCenterCapacityValidator = z.object({
  id: zfd.text(z.string().optional()),
  workCenterId: z.string().min(1),
  effectiveFrom: z.string().min(1, { message: "Effective from is required" }),
  effectiveTo: zfd.text(z.string().optional()),
  parallelCapacity: zfd.numeric(z.number().int().min(0)),
});
```

2. Add service functions to `resources.service.ts`, following the exact house
   shape (client first arg, return raw `{data,error}`, list functions scope
   `companyId` + `setGenericQueryFilters`):
   - `getResourceCalendars(client, companyId, args)` — paginated list with `search` on name, default sort name asc
   - `getResourceCalendarsList(client, companyId)` — full list for dropdowns (id, name, locationId), `.eq("active", true)`
   - `getResourceCalendar(client, id)` — `.single()`
   - `getResourceCalendarShifts(client, resourceCalendarId)` — ordered by dayOfWeek, startTime
   - `getResourceCalendarExceptions(client, resourceCalendarId)` — ordered by startAt
   - `upsertResourceCalendar(client, data)` — createdBy/updatedBy union branch, `sanitize` on update (copy `upsertWorkCenter`)
   - `deleteResourceCalendar(client, id)` — soft: `.update({ active: false })` (calendars may be referenced by work centers)
   - `upsertResourceCalendarShift(client, data)` / `deleteResourceCalendarShift(client, id)` (hard delete — pattern rows are not referenced)
   - `upsertResourceCalendarException(client, data)` / `deleteResourceCalendarException(client, id)` (hard delete)
   - `getWorkCenterCapacities(client, workCenterId)` — ordered by effectiveFrom
   - `upsertWorkCenterCapacity(client, data)` / `deleteWorkCenterCapacity(client, id)` (hard delete)

3. Add path helpers in `apps/erp/app/utils/path.ts` next to the existing
   work-center helpers: `resourceCalendars`, `newResourceCalendar`,
   `resourceCalendar(id)`, `deleteResourceCalendar(id)`, plus nested shift/
   exception/capacity helpers as needed by Tasks 3 and 5. Follow the naming of
   the `workCenters`/`workCenter(id)` helpers exactly.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** routes/UI (Task 3), engine reads (Task 16 uses Kysely in the
edge function, not these services).

---

## Task 3: Resource calendar CRUD UI

**Depends on:** Task 2
**Files:**
- Create: `apps/erp/app/routes/x+/resources+/calendars.tsx` (list)
- Create: `apps/erp/app/routes/x+/resources+/calendars.new.tsx`
- Create: `apps/erp/app/routes/x+/resources+/calendars.$id.tsx` (edit — loads calendar + shifts + exceptions)
- Create: `apps/erp/app/routes/x+/resources+/calendars.delete.$id.tsx`
- Create: `apps/erp/app/modules/resources/ui/Calendars/ResourceCalendarsTable.tsx`
- Create: `apps/erp/app/modules/resources/ui/Calendars/ResourceCalendarForm.tsx`
- Create: `apps/erp/app/modules/resources/ui/Calendars/index.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/resources+/work-centers.tsx` + `work-centers.new.tsx` + `work-centers.$id.tsx` + `work-centers.delete.$id.tsx`; table `apps/erp/app/modules/resources/ui/WorkCenters/WorkCentersTable.tsx`; form `apps/erp/app/modules/resources/ui/WorkCenters/WorkCenterForm.tsx`; weekly time windows `apps/erp/app/modules/people/ui/Shifts/ShiftForm.tsx` (TimePicker + day toggles)

**Steps:**

1. `calendars.tsx`: mirror `work-centers.tsx` — `requirePermissions(request, { view: "resources" })`, loader calls `getResourceCalendars` + `getLocationsList`, renders `<ResourceCalendarsTable>` + `<Outlet />`. Columns: name, location, active, shift-count.
2. `ResourceCalendarForm.tsx`: `ModalDrawer` form (copy WorkCenterForm) with `Input name="name"` + `Location name="locationId" isClearable`. Creating a calendar creates the header only.
3. `calendars.$id.tsx` edit drawer additionally manages child rows inline:
   - **Weekly pattern section**: list `resourceCalendarShift` rows grouped by day; add/remove rows with `TimePicker` start/end and a day-of-week `Select` (0–6, labeled Sunday–Saturday). Submit each row to the same action with an `intent` field (`upsert-shift` / `delete-shift`), validated with `resourceCalendarShiftValidator`. Copy the TimePicker usage from `ShiftForm.tsx`.
   - **Exceptions section**: rows with name, start/end (DatePicker + time or datetime input — reuse whatever `ShiftForm`/holiday forms use for dates), type `Select` (Closed/Open/ReducedCapacity), optional capacityOverride number input; `upsert-exception` / `delete-exception` intents.
   - Action branches on `intent`, calls the matching service, returns flash via the standard `redirect ... await flash(...)` pattern used in `work-centers.$id.tsx`.
4. Register the nav item: find where "Work Centers" is declared in the resources module nav config (grep for `"Work Centers"` under `apps/erp/app/modules/resources/`) and add "Calendars" beside it, pointing at `path.to.resourceCalendars`.
5. Permissions: `create`/`update`/`delete: "resources"` in the respective actions, same as work-centers routes.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** assigning calendars to work centers (Task 4), any Gantt/
timeline visualization of the calendar.

---

## Task 4: Work center form — capacity/calendar fields

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/resources/resources.models.ts` — extend `workCenterValidator` (line ~479)
- Modify: `apps/erp/app/modules/resources/ui/WorkCenters/WorkCenterForm.tsx`
- Modify: `apps/erp/app/modules/resources/ui/WorkCenters/WorkCentersTable.tsx` — add schedulingMode + parallelCapacity columns
- Copy from (precedent): existing fields in the same form; `Ability` combobox pattern already commented out at WorkCenterForm.tsx:156–160 shows the combobox style

**Steps:**

1. Extend `workCenterValidator` with:
```typescript
  parallelCapacity: zfd.numeric(z.number().int().min(1)),
  efficiencyFactor: zfd.numeric(z.number().gt(0)),
  schedulingMode: z.enum(["Finite", "Infinite"]),
  resourceCalendarId: zfd.text(z.string().optional()),
```
2. In `WorkCenterForm.tsx` add: `Number name="parallelCapacity"` (label
   "Parallel Capacity", helper "Simultaneous operations this work center can
   run"), `Number name="efficiencyFactor"` (label "Efficiency Factor"),
   `Select name="schedulingMode"` with Finite/Infinite options, and a
   `Combobox`/select for `resourceCalendarId` fed by a new
   `api+/resources.calendars.ts` cached list route (copy
   `apps/erp/app/routes/api+/resources.abilities.ts` exactly, calling
   `getResourceCalendarsList`). Defaults in `initialValues`: parallelCapacity 1,
   efficiencyFactor 1.0, schedulingMode "Finite".
3. `upsertWorkCenter` in resources.service.ts passes the new fields through
   automatically if it spreads the validated payload — confirm; if it lists
   columns explicitly, add the four new ones.
4. While in this file: **uncomment** the existing `requiredAbilityId` field
   (WorkCenterForm.tsx:156–160 `<Ability name="requiredAbilityId" .../>` and the
   validator line ~494) — the spec keeps it as the coarse skill fallback and the
   column already exists. If uncommenting breaks because the `Ability` component
   was removed, STOP and report; do not rewrite the component.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** time-phased capacity rows (Task 5), scheduler consumption of
these fields (Tasks 16–18).

---

## Task 5: Time-phased capacity editor on work center

**Depends on:** Task 2
**Files:**
- Create: `apps/erp/app/routes/x+/resources+/work-centers.$workCenterId.capacity.tsx`
- Modify: `apps/erp/app/modules/resources/ui/WorkCenters/WorkCentersTable.tsx` — row action "Edit Capacity Overrides" opening the new route
- Copy from (precedent): `apps/erp/app/routes/x+/resources+/work-centers.$workCenterId.rules.tsx` + `work-centers.rules.assign.$workCenterId.tsx` (the per-work-center child-relation drawer pattern)

**Steps:**

1. Loader: `requirePermissions({ view: "resources" })`, load work center name +
   `getWorkCenterCapacities(client, workCenterId)`.
2. Drawer UI: table of override rows (effectiveFrom, effectiveTo, parallelCapacity)
   with inline add/edit/delete using `workCenterCapacityValidator`; intents
   `upsert-capacity` / `delete-capacity` in the action, calling
   `upsertWorkCenterCapacity` / `deleteWorkCenterCapacity`.
3. Reject overlapping date ranges in the action: fetch existing rows, if the new
   `[effectiveFrom, effectiveTo ?? ∞)` intersects an existing row (other than
   the one being edited), return a validation error "Overlaps an existing
   capacity override".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** engine consumption (Task 16).

---

## Task 6: Migration — ability requirements, eligibility columns

**Depends on:** none (parallel with 1)
**Files:**
- Create: `packages/database/supabase/migrations/<generated>_operation-abilities.sql` (via `pnpm db:migrate:new operation-abilities`)
- Copy from (precedent): `jobOperationTool` handling in migrations (child-of-operation join table) and the RLS template

**Steps:**

1. `pnpm db:migrate:new operation-abilities`
2. SQL — three requirement tables + eligibility columns:

```sql
-- Template default at the process level (coarse)
CREATE TABLE "processAbility" (
    "id" TEXT NOT NULL DEFAULT id('pab'),
    "companyId" TEXT NOT NULL,
    "processId" TEXT NOT NULL REFERENCES "process"("id") ON DELETE CASCADE,
    "abilityId" TEXT NOT NULL REFERENCES "ability"("id") ON DELETE CASCADE,
    "minimumProficiency" NUMERIC,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "processAbility_process_ability_key" ON "processAbility" ("processId", "abilityId", "companyId");
CREATE INDEX "processAbility_companyId_idx" ON "processAbility" ("companyId");
CREATE INDEX "processAbility_processId_idx" ON "processAbility" ("processId");
CREATE INDEX "processAbility_abilityId_idx" ON "processAbility" ("abilityId");
CREATE INDEX "processAbility_createdBy_idx" ON "processAbility" ("createdBy");

-- Routing-template level (copied to jobs at explosion)
CREATE TABLE "methodOperationAbility" (
    "id" TEXT NOT NULL DEFAULT id('moa'),
    "companyId" TEXT NOT NULL,
    "methodOperationId" TEXT NOT NULL REFERENCES "methodOperation"("id") ON DELETE CASCADE,
    "abilityId" TEXT NOT NULL REFERENCES "ability"("id") ON DELETE CASCADE,
    "minimumProficiency" NUMERIC,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "methodOperationAbility_op_ability_key" ON "methodOperationAbility" ("methodOperationId", "abilityId", "companyId");
CREATE INDEX "methodOperationAbility_companyId_idx" ON "methodOperationAbility" ("companyId");
CREATE INDEX "methodOperationAbility_methodOperationId_idx" ON "methodOperationAbility" ("methodOperationId");
CREATE INDEX "methodOperationAbility_abilityId_idx" ON "methodOperationAbility" ("abilityId");
CREATE INDEX "methodOperationAbility_createdBy_idx" ON "methodOperationAbility" ("createdBy");

-- Concrete requirement on a job operation (what the scheduler + MES enforce)
CREATE TABLE "jobOperationAbility" (
    "id" TEXT NOT NULL DEFAULT id('joa'),
    "companyId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL REFERENCES "jobOperation"("id") ON DELETE CASCADE,
    "abilityId" TEXT NOT NULL REFERENCES "ability"("id") ON DELETE CASCADE,
    "minimumProficiency" NUMERIC,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "jobOperationAbility_op_ability_key" ON "jobOperationAbility" ("operationId", "abilityId", "companyId");
CREATE INDEX "jobOperationAbility_companyId_idx" ON "jobOperationAbility" ("companyId");
CREATE INDEX "jobOperationAbility_operationId_idx" ON "jobOperationAbility" ("operationId");
CREATE INDEX "jobOperationAbility_abilityId_idx" ON "jobOperationAbility" ("abilityId");
CREATE INDEX "jobOperationAbility_createdBy_idx" ON "jobOperationAbility" ("createdBy");

-- Eligibility columns
ALTER TABLE "employeeAbility"
    ADD COLUMN "expiresAt" DATE,
    ADD COLUMN "proficiencyOverride" NUMERIC;
ALTER TABLE "ability" ADD COLUMN "recertifyEveryDays" INTEGER;
```

3. RLS: standard four-policy block per table with these scopes —
   `processAbility` → `resources_*`; `methodOperationAbility` → `parts_*`
   (mirrors `methodOperation`); `jobOperationAbility` → `production_*` (mirrors
   `jobOperation`).
4. Apply: `pnpm db:migrate`, then confirm types regenerated.

**Verify:**
```bash
pnpm db:migrate
# Expected: applies <timestamp>_operation-abilities.sql with no error
grep -l "jobOperationAbility" packages/database/src/*.ts | head -1
# Expected: at least one generated types file matches
```

**Out of scope:** `training.grantsAbilityId` and the trainingCompletion trigger
(spec phase 7 — NOT in this plan), quote-side operation abilities.

---

## Task 7: Ability-requirement models + services + shared proficiency util

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/production/production.models.ts` — extend `jobOperationValidator` with `abilities: z.array(z.string()).optional()`
- Modify: `apps/erp/app/modules/items/items.models.ts` — extend `methodOperationValidator` the same way
- Modify: `apps/erp/app/modules/production/production.service.ts` — sync helpers for `jobOperationAbility`
- Modify: `apps/erp/app/modules/items/items.service.ts` — sync helpers for `methodOperationAbility`
- Modify: `apps/erp/app/modules/resources/resources.models.ts` — `employeeAbilityValidator` gains `expiresAt` (optional date string) + `proficiencyOverride` (optional numeric); `abilityValidator` gains `recertifyEveryDays` (optional int)
- Create: `apps/erp/app/modules/resources/utils/proficiency.ts`
- Copy from (precedent): how `upsertJobOperation`/`upsertMethodOperation` handle child rows today (grep for `jobOperationTool` writes in the ERP services/routes to mirror the sync approach — if tools are synced elsewhere, mirror THAT location instead and note it)

**Steps:**

1. Service sync helpers (same shape in both modules):
```typescript
export async function syncJobOperationAbilities(
  client: SupabaseClient<Database>,
  operationId: string,
  companyId: string,
  abilityIds: string[],
  userId: string
) {
  const del = await client
    .from("jobOperationAbility")
    .delete()
    .eq("operationId", operationId)
    .eq("companyId", companyId);
  if (del.error) return del;
  if (abilityIds.length === 0) return del;
  return client.from("jobOperationAbility").insert(
    abilityIds.map((abilityId) => ({ operationId, abilityId, companyId, createdBy: userId }))
  );
}
```
   plus `getJobOperationAbilities(client, operationId)`; mirror both for
   `methodOperationAbility` (`syncMethodOperationAbilities`,
   `getMethodOperationAbilities`) in items.service.ts. v1 sends ability ids only
   — `minimumProficiency` stays NULL from the UI (schedulers treat NULL as "any
   proficiency").
2. Proficiency util (`apps/erp/app/modules/resources/utils/proficiency.ts`):
```typescript
// Derived proficiency 0..1: evaluate the ability's learning curve at the weeks
// since last training. Duplicated (small + pure) in
// packages/database/supabase/functions/lib/scheduling/proficiency.ts — keep in sync.
export function deriveProficiency(args: {
  curve: unknown;               // ability.curve JSONB
  shadowWeeks: number;
  lastTrainingDate: string | null;
  proficiencyOverride: number | null;
  asOf?: Date;
}): number
```
   Read the exact curve JSON shape from `abilityCurveValidator`
   (resources.models.ts:5) and the existing `getTrainingStatus` logic in
   `apps/erp/app/modules/resources/types.ts` before implementing: linear
   interpolation between curve points at `weeksSince = (asOf − lastTrainingDate)/7d`,
   clamped to [0, 1]; `proficiencyOverride` wins when non-null; no
   `lastTrainingDate` → 0. If the curve shape is not inferable from those two
   files, STOP and report — do not invent a shape.
3. `resources.models.ts` validator additions per Files above; extend
   `upsertAbility`/`insertEmployeeAbilities`-adjacent update functions to pass
   the new columns through (check each touched function's column list).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** UI fields (Tasks 9–11), MES (Task 12), Deno copy of the
proficiency util (Task 17 creates it).

---

## Task 8: Copy method abilities → job abilities in get-method + rework

**Depends on:** Task 6
**Files:**
- Modify: `packages/database/supabase/functions/get-method/index.ts` — three `insertInto("jobOperation")` explosion branches (~lines 543–698 main tree loop, ~1332, ~4583)
- Modify: `packages/database/supabase/functions/trigger-rework/index.ts` — jobOperation insert (~line 210)

**Steps:**

1. In `get-method/index.ts`, locate the main tree recursion where
   `methodOperation` rows are read (~lines 547–552) and child rows are copied
   per returned operation id (`jobOperationTool` copy at ~718–729). Line numbers
   may have drifted — locate by searching `insertInto("jobOperationTool")`.
2. Add `methodOperationAbility(*)` to the methodOperation select, and inside the
   same per-operation loop insert `jobOperationAbility` rows:
```typescript
if (op.methodOperationAbility?.length) {
  await trx.insertInto("jobOperationAbility").values(
    op.methodOperationAbility.map((a) => ({
      operationId,
      abilityId: a.abilityId,
      minimumProficiency: a.minimumProficiency,
      companyId,
      createdBy: userId,
    }))
  ).execute();
}
```
3. Repeat for the other two `insertInto("jobOperation")` branches in the same
   file (search `insertInto("jobOperation")` — there are three sites total). If
   a branch's source is not `methodOperation` (e.g. quote operations), copy from
   whatever operation-template table that branch reads **only if** it has an
   ability child table; otherwise skip that branch and leave a one-line comment
   stating abilities are not copied on that path. Do not invent a
   `quoteOperationAbility` table.
4. In `trigger-rework/index.ts` (~line 210), the new rework operation is cloned
   from an existing `jobOperation` — also clone its `jobOperationAbility` rows
   (select by source operation id, re-insert with the new operation id).

**Verify:**
```bash
cd packages/database/supabase/functions && deno check get-method/index.ts trigger-rework/index.ts
# Expected: no type errors. If `deno` is not installed or the check fails on
# pre-existing import-map issues unrelated to this change, STOP and report
# rather than restructuring imports.
```

**Out of scope:** scheduler consumption (Task 17), UI.

---

## Task 9: Required-abilities field on method + job operation editors

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx` — add `<Abilities name="abilities" label="Required Abilities" />` next to the existing WorkCenter/assignee fields
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` — same for the method template editor
- Modify: `apps/erp/app/routes/x+/job+/methods+/$jobId.operation.$id.tsx` and `$jobId.operation.new.tsx` — parse `abilities` from the validated payload, call `syncJobOperationAbilities` after `upsertJobOperation`; loader supplies current ability ids as `initialValues.abilities`
- Modify: `apps/erp/app/routes/x+/items+/methods+/operation.$id.tsx` and `operation.new.tsx` — same with `syncMethodOperationAbilities`
- Copy from (precedent): the ready-made multi-select `apps/erp/app/components/Form/Abilities.tsx` (wraps MultiSelect, options from `useAbilities()`)

**Steps:**

1. Add the `<Abilities>` field to both editors. `zfd` array handling: use the
   same pattern as any existing multi-select field in these forms (grep for
   `z.array(z.string())` in the models file to match parsing).
2. In each action, after the operation upsert succeeds, call the sync helper
   with `formData.abilities ?? []`. On sync error, return the standard flash
   error path.
3. In each loader/drawer initial values, fetch current rows via
   `getJobOperationAbilities`/`getMethodOperationAbilities` and map to ids.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** processAbility UI (defaulting from process is engine-side
fallback only in this plan; a process-level editor can come later), proficiency
threshold input (v1 UI sends ability ids only).

---

## Task 10: Abilities admin UI (list + form, expiry fields)

**Depends on:** Task 7
**Files:**
- Create: `apps/erp/app/routes/x+/resources+/abilities.tsx`, `abilities.new.tsx`, `abilities.$id.tsx`, `abilities.delete.$id.tsx`
- Create: `apps/erp/app/modules/resources/ui/Abilities/AbilitiesTable.tsx`, `AbilityForm.tsx`, `index.ts`
- Copy from (precedent): `apps/erp/app/routes/x+/resources+/work-centers.tsx` family + `WorkCentersTable.tsx`/`WorkCenterForm.tsx`
- Modify: resources nav config (same place Task 3 registered "Calendars") — add "Abilities"

**Steps:**

1. The service layer already exists (`getAbilities`, `getAbility`,
   `insertAbility`, `updateAbility`, `deleteAbility` in resources.service.ts)
   and `path.to.abilities`/`path.to.ability(id)` helpers already point at
   `x+/resources/abilities` — build the routes those helpers expect. Check
   `path.to` definitions in `apps/erp/app/utils/path.ts` and match the paths
   exactly.
2. `AbilityForm`: name (Input), shadowWeeks (Number), recertifyEveryDays
   (Number, optional, helper "Qualification expires this many days after
   training; blank = never"). Do NOT build a curve editor — keep the existing
   default curve JSON on insert (see `insertAbility` signature for what it
   expects).
3. List columns: name, active, recertifyEveryDays, # qualified employees
   (`employeeAbility` count — add to the `getAbilities` select as an embedded
   count if not present).
4. Delete route: soft-delete (`active: false`) via existing `deleteAbility` —
   check its implementation first; if it hard-deletes, change route wiring to
   update `active` instead (abilities are now referenced by requirement tables).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** person × ability grid (Task 11), learning-curve editing.

---

## Task 11: Skills matrix UI (person × ability grid)

**Depends on:** Task 7
**Files:**
- Create: `apps/erp/app/routes/x+/resources+/skills-matrix.tsx`
- Create: `apps/erp/app/routes/x+/resources+/skills-matrix.$employeeId.$abilityId.tsx` (edit drawer)
- Create: `apps/erp/app/modules/resources/ui/Abilities/SkillsMatrix.tsx`
- Copy from (precedent): status logic `getTrainingStatus` + `AbilityEmployeeStatus` in `apps/erp/app/modules/resources/types.ts`; read-only card `apps/erp/app/modules/people/ui/Person/PersonAbilities.tsx`; drawer pattern from Task 5's capacity editor
- Modify: resources nav config — add "Skills Matrix"

**Steps:**

1. Loader: `getAbilitiesList(client, companyId)` + all employee abilities for
   the company. `getEmployeeAbilities` may be scoped to one ability — add
   `getEmployeeAbilitiesByCompany(client, companyId)` to resources.service.ts if
   needed (join `employeeAbility` → `user` full name via the same embedded
   select `PersonAbilities.tsx` uses).
2. `SkillsMatrix.tsx`: rows = employees (from the employees list source
   `PersonAbilities`/people module uses), columns = active abilities, cell =
   status chip: qualified (green), in-training (amber, from
   `getTrainingStatus`), expiring soon (amber with days-left when `expiresAt`
   within 90 days — 30/60/90 tiers), expired (red, `expiresAt < today`), blank =
   not qualified. Client-side filter input over employee name.
3. Cell click → edit drawer route: form with `active` (Boolean),
   `trainingCompleted` (Boolean), `lastTrainingDate` (DatePicker), `expiresAt`
   (DatePicker), `proficiencyOverride` (Number 0–1, optional). Action upserts
   the `employeeAbility` row (insert if the pair doesn't exist) using the
   extended `employeeAbilityValidator`; permission `update: "resources"`.
4. When `expiresAt` is blank and the ability has `recertifyEveryDays` and
   `lastTrainingDate` is set, compute and save
   `expiresAt = lastTrainingDate + recertifyEveryDays` in the action (server-side
   default, overridable by explicit input).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** training-source column beyond what `employeeAbility` already
stores (Academy/training bridge is phase 7), notifications for expiring quals.

---

## Task 12: MES eligibility lockout on operation start

**Depends on:** Task 7
**Files:**
- Modify: `apps/mes/app/services/operations.service.ts` — add `getOperationEligibility`
- Create: `apps/mes/app/services/proficiency.ts` — copy of the pure util from Task 7 step 2 (MES cannot import from apps/erp; keep the same "keep in sync" comment)
- Modify: `apps/mes/app/routes/x+/start.$operationId.tsx` — eligibility gate in the loader/action beside the existing maintenance-block check (`getWorkCenterWithBlockingStatus`) and storage-rule check, before `startProductionEvent` (~line 168)
- Copy from (precedent): the maintenance-block redirect-with-flash pattern already in that route

**Steps:**

1. `getOperationEligibility(client, { operationId, employeeId, companyId })`:
   - Fetch `jobOperationAbility` rows for the operation. If none, fetch the
     operation's `workCenterId` → `workCenter.requiredAbilityId`; if that is
     also null, return `{ eligible: true, reason: null }` (ungated).
   - For each required ability: fetch the employee's `employeeAbility` row
     joined to `ability` (curve, shadowWeeks). Eligible for that ability iff
     `active && trainingCompleted && (expiresAt == null || expiresAt > today) &&
     deriveProficiency(...) >= (minimumProficiency ?? 0)`.
   - Return `{ eligible, reason }` where reason names the first failing ability
     and cause, e.g. `"Requires Welding — qualification expired 2026-06-01"`,
     `"Requires CNC — not qualified"`.
2. Gate in `start.$operationId.tsx`: if not eligible, redirect back to
   `path.to.operation(operationId)` with `flash(error(...reason))` — byte-for-byte
   the same mechanics as the maintenance block.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: exit 0
```

**Out of scope:** blocking mid-operation events for an already-started operator,
ERP-side assignee validation (assignee remains a soft field in v1).

---

## Task 13: Migration — capacity reservations + scheduling policy

**Depends on:** none (parallel with 1/6)
**Files:**
- Create: `packages/database/supabase/migrations/<generated>_capacity-reservations.sql` (via `pnpm db:migrate:new capacity-reservations`)

**Steps:**

1. `pnpm db:migrate:new capacity-reservations`
2. SQL:

```sql
CREATE TYPE "capacityResourceKind" AS ENUM ('WorkCenter', 'OperatorPool');
CREATE TYPE "schedulingDispatchRule" AS ENUM ('FIFO', 'EDD', 'SPT', 'WSPT', 'CR', 'MinSlack');

-- Durable slot allocations written by the scheduler (authoritative across jobs/runs)
CREATE TABLE "capacityReservation" (
    "id" TEXT NOT NULL DEFAULT id('cres'),
    "companyId" TEXT NOT NULL,
    "resourceKind" "capacityResourceKind" NOT NULL,
    "resourceId" TEXT NOT NULL, -- workCenter.id or ability.id (OperatorPool)
    "operationId" TEXT NOT NULL REFERENCES "jobOperation"("id") ON DELETE CASCADE,
    "jobId" TEXT NOT NULL REFERENCES "job"("id") ON DELETE CASCADE,
    "startAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "endAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "scenarioId" TEXT, -- null = live plan; scenario engine is a later phase
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CHECK ("endAt" > "startAt")
);
CREATE INDEX "capacityReservation_companyId_idx" ON "capacityReservation" ("companyId");
CREATE INDEX "capacityReservation_resource_window_idx" ON "capacityReservation" ("resourceId", "startAt", "endAt");
CREATE INDEX "capacityReservation_operationId_idx" ON "capacityReservation" ("operationId");
CREATE INDEX "capacityReservation_jobId_idx" ON "capacityReservation" ("jobId");
CREATE INDEX "capacityReservation_createdBy_idx" ON "capacityReservation" ("createdBy");

-- Dispatch-rule policy: one company default row (workCenterId null) + per-WC overrides
CREATE TABLE "schedulingPolicy" (
    "id" TEXT NOT NULL DEFAULT id('spol'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "dispatchRule" "schedulingDispatchRule" NOT NULL DEFAULT 'EDD',
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "schedulingPolicy_company_wc_key"
    ON "schedulingPolicy" ("companyId", COALESCE("workCenterId", ''));
CREATE INDEX "schedulingPolicy_companyId_idx" ON "schedulingPolicy" ("companyId");
CREATE INDEX "schedulingPolicy_workCenterId_idx" ON "schedulingPolicy" ("workCenterId");
CREATE INDEX "schedulingPolicy_createdBy_idx" ON "schedulingPolicy" ("createdBy");
```

3. RLS: four-policy blocks, scope `production_*` for both tables.
4. Apply: `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: applies <timestamp>_capacity-reservations.sql with no error
grep -l "capacityReservation" packages/database/src/*.ts | head -1
# Expected: a generated types file matches
```

**Out of scope:** `schedulingScenario`/`scenarioOverride` tables (phase 6 — do
NOT create them; `scenarioId` stays a plain nullable TEXT for now), policy
admin UI.

---

## Task 14: Scheduler refactor — MasterDataProvider seam

**Depends on:** none (code-only; no behavior change)
**Files:**
- Create: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts` — replace its 14 inline read sites with provider calls
- Modify: `packages/database/supabase/functions/lib/scheduling/work-center-selector.ts` — `calculateLoadBeforeDate`'s query and `initialize`'s two queries move behind the provider
- Modify: `packages/database/supabase/functions/lib/scheduling/assembly-handler.ts` — 3 read sites (incl. the `get_job_methods_by_method_id` RPC via `lib/methods.ts`)
- Modify: `packages/database/supabase/functions/lib/scheduling/material-manager.ts` — 1 read site (the unlinked-materials select; its UPDATE write stays direct)
- Delete: `packages/database/supabase/functions/lib/scheduling/resource-manager.ts` — dead code, imported nowhere (verify with grep before deleting; if anything imports it, STOP and report)
- Modify: `packages/database/supabase/functions/schedule/index.ts` — construct `new KyselyMasterDataProvider(db, client, companyId)` and pass it into `SchedulingEngine`

**Steps:**

1. Define the interface covering exactly today's reads (return types = the
   existing row shapes already used at each call site — lift them, don't
   redesign):
```typescript
export interface MasterDataProvider {
  getJob(jobId: string): Promise<...>;
  getOperations(jobId: string, opts?: { includeDone?: boolean }): Promise<...>;
  getDependencies(jobId: string): Promise<...>;
  getReworkDependencies(jobId: string, reworkIds: string[]): Promise<...>;
  getMaterialsWithMakeMethod(jobId: string): Promise<...>;
  getUnlinkedMaterials(jobId: string): Promise<...>;
  getRootMakeMethod(jobId: string): Promise<...>;
  getJobMethodTree(methodId: string): Promise<...>;
  getProcessesWithWorkCenters(): Promise<...>;
  getActiveWorkCenters(locationId: string): Promise<...>;
  getWorkCenterLoadOperations(workCenterId: string, beforeDate: string | null): Promise<...>;
  getCrossJobOperationsAtWorkCenters(workCenterIds: string[]): Promise<...>;
}
```
2. `KyselyMasterDataProvider` implements it by moving each existing query
   verbatim (same filters, same columns, `companyId` scoping preserved). The
   assembly-tree RPC keeps using the supabase client inside the provider.
3. Thread the provider through constructors (`SchedulingEngine`,
   `WorkCenterSelector`, `AssemblyHandler`, `MaterialManager` — all already take
   clients in constructors; add the provider alongside, keep `db` for writes).
4. **Zero behavior change**: writes (`persistChanges`, dependency delete/insert,
   status updates, material updates) stay on `db`/`trx` exactly as-is. Do not
   dedupe the triple `buildAssemblyTree` call in this task — provider-level
   memoization of `getRootMakeMethod`/`getJobMethodTree`/`getOperations` per
   run is allowed only if results are provably identical across the three calls;
   when in doubt, don't.

**Verify:**
```bash
grep -rn "resource-manager" packages/database/supabase/functions | grep -v "lib/scheduling/resource-manager.ts"
# Expected: no output (safe to delete)
cd packages/database/supabase/functions && deno check schedule/index.ts
# Expected: no type errors. If deno is unavailable, STOP and report.
```

**Out of scope:** any capacity/calendar/skill logic (Tasks 16–17), scenario
overlay provider (phase 6), changing the engine's phase order or write behavior.

---

## Task 15: Calendar expansion + slot-walking utilities (pure, with Deno tests)

**Depends on:** none (pure code; shapes match Task 1 tables)
**Files:**
- Create: `packages/database/supabase/functions/lib/scheduling/calendar-utils.ts`
- Create: `packages/database/supabase/functions/lib/scheduling/calendar-utils.test.ts`
- Copy from (precedent): pure-module style of `lib/scheduling/date-calculator.ts` + `duration-calculator.ts`; test style of `packages/database/supabase/functions/post-payment/post-payment.test.ts` (Deno test conventions in this repo)

**Steps:**

1. Types + functions (all pure, no DB):
```typescript
export type CalendarShiftRow = { dayOfWeek: number; startTime: string; endTime: string };
export type CalendarExceptionRow = { startAt: Date; endAt: Date; type: "Closed" | "Open" | "ReducedCapacity"; capacityOverride: number | null };
export type CalendarWindow = { start: Date; end: Date; capacityFactor: number }; // factor 1 normally, <1 reduced

// Expand weekly pattern + exceptions into concrete windows over [rangeStart, rangeEnd).
// Empty shifts array => one 24x7 window covering the whole range (back-compat: no calendar = always open).
export function expandCalendar(shifts, exceptions, rangeStart: Date, rangeEnd: Date): CalendarWindow[];

// Earliest interval >= earliestStart inside `windows` accumulating `durationHours`
// of working time (an operation may span multiple windows). `isFree(start, end)`
// is consulted per candidate working interval; on rejection the walk resumes
// from `nextTryAfter` returned by isFree (or the next window boundary).
export function findSlot(args: {
  windows: CalendarWindow[];
  durationHours: number;
  earliestStart: Date;
  isFree: (start: Date, end: Date) => { free: boolean; nextTryAfter?: Date };
}): { start: Date; end: Date } | null;

// Count reservations overlapping [start, end)
export function countOverlaps(reservations: { startAt: Date; endAt: Date }[], start: Date, end: Date): number;
```
   Exception semantics in `expandCalendar`: `Closed` subtracts overlap from
   windows; `Open` adds a window; `ReducedCapacity` sets `capacityFactor` on
   the overlapped portion (split windows at exception boundaries).
   Timezone: expansion is done in UTC against Date objects; the caller converts
   local shift times to concrete Dates using the location IANA timezone — add a
   helper `shiftTimeToDate(dayDate: Date, time: string, timezone: string): Date`
   using `Intl.DateTimeFormat` offset math (no external deps in Deno).
2. Tests (min 8 cases): weekly expansion across a week boundary; split shifts
   (two rows same day); Closed exception removing a full day; Open exception
   adding weekend time; ReducedCapacity splitting a window; findSlot spanning
   two windows; findSlot returns null when nothing fits before rangeEnd; empty
   shifts → 24×7; DST transition day for a named zone (e.g. America/Chicago) —
   assert the window length is still endTime−startTime local.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/calendar-utils.test.ts
# Expected: all tests pass. If `deno` is not on PATH, STOP and report (ask the
# user how they run the existing post-payment.test.ts) — do not skip tests.
```

**Out of scope:** DB reads, reservations persistence, direction=backward
mirroring (allocation walks forward; see Task 16 note).

---

## Task 16: Finite slot allocator — machine capacity

**Depends on:** Tasks 1, 13, 14, 15
**Files:**
- Create: `packages/database/supabase/functions/lib/scheduling/slot-allocator.ts`
- Create: `packages/database/supabase/functions/lib/scheduling/slot-allocator.test.ts`
- Modify: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts` — add batched capacity reads:
  `getWorkCenterCalendars(workCenterIds)` (calendar + shifts + exceptions + location timezone, with location-default fallback: all active calendars at the WC's location when `resourceCalendarId` is null),
  `getWorkCenterCapacityOverrides(workCenterIds)`,
  `getLiveReservations(resourceIds, fromDate, excludeJobId)` (scenarioId null only),
  `getSchedulingPolicies()`
- Modify: `packages/database/supabase/functions/lib/scheduling/work-center-selector.ts` — finite path

**Steps:**

1. `slot-allocator.ts` exports `allocateOperation(args)` — pure given preloaded
   data (testable with fixtures, no DB):
```typescript
export type ResourceCapacityData = {
  workCenter: { id: string; parallelCapacity: number; efficiencyFactor: number; schedulingMode: "Finite" | "Infinite" };
  windows: CalendarWindow[];                    // from expandCalendar, already tz-resolved
  capacityOverrides: { effectiveFrom: string; effectiveTo: string | null; parallelCapacity: number }[];
  reservations: { startAt: Date; endAt: Date }[]; // existing WC reservations (other jobs + earlier ops this run)
};
export function allocateOperation(args: {
  durationHours: number;        // standard duration / workCenter.efficiencyFactor
  earliestStart: Date;
  horizonEnd: Date;             // e.g. earliestStart + 365d — never walk unbounded
  capacity: ResourceCapacityData;
}): { start: Date; end: Date } | { conflict: string };
```
   `isFree(start, end)` = at every point in the interval,
   `countOverlaps(reservations, ...) < effectiveParallelCapacity(date)` where
   `effectiveParallelCapacity` = capacity override row covering the date, else
   `parallelCapacity`, scaled by the window's `capacityFactor` (floor, min 0).
   On busy, `nextTryAfter` = earliest reservation `endAt` inside the interval.
2. `schedulingMode === "Infinite"` → bypass entirely: return the dates the
   existing engine math produced (caller keeps current behavior; the allocator
   is simply not consulted).
3. Wire into `work-center-selector.ts`: for each candidate work center of the
   process, run `allocateOperation`; pick the candidate with the **earliest
   finish** (tie → lowest existing load, preserving today's least-loaded
   spirit). Return the placement `{workCenterId, start, end}` alongside the
   selection so the engine can persist reservation rows (Task 18).
   **Direction note:** finite allocation always walks **forward** from the
   earliest feasible start (predecessor finish per the DAG). In
   `direction: "backward"` runs, the backward-computed date becomes the target:
   after forward placement, if `end` (as a date) > the operation's
   backward-computed `dueDate`, mark conflict `"No capacity before due date at
   <work center>"` but keep the placement. If the engine's structure makes this
   integration point materially different from described, STOP and report — do
   not restructure the engine phases.
4. In-memory: reservations placed earlier in the current run are appended to
   `capacity.reservations` so later operations see them (replaces the old
   `inMemoryLoadByWorkCenter` for finite WCs; keep the old load path for
   Infinite WCs).
5. Tests with fixture data (no DB): fills a 1-capacity WC sequentially; parallel
   ops overlap when parallelCapacity=2; overbooking never happens across 10
   random ops (assert max concurrent ≤ capacity by sweeping reservation
   boundaries); capacity override window lowers capacity mid-horizon; Closed
   exception pushes a slot to the next day; Infinite mode bypasses; horizon
   exhaustion returns conflict.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/slot-allocator.test.ts && deno check schedule/index.ts
# Expected: all tests pass, no type errors
```

**Out of scope:** operator constraint (Task 17), reservation writes (Task 18),
backward-walking allocation.

---

## Task 17: Operator-pool DRC + dispatch policy

**Depends on:** Tasks 6, 16
**Files:**
- Create: `packages/database/supabase/functions/lib/scheduling/proficiency.ts` — Deno copy of the pure util from Task 7 (same "keep in sync" comment)
- Modify: `packages/database/supabase/functions/lib/scheduling/master-data-provider.ts` — add:
  `getOperationRequiredAbilities(operationIds)` (jobOperationAbility rows; per operation fall back to `processAbility` for the op's processId, then to `workCenter.requiredAbilityId`),
  `getQualifiedEmployees(abilityIds)` (employeeAbility ⋈ ability: active, trainingCompleted, expiresAt, lastTrainingDate, proficiencyOverride, curve, shadowWeeks)
- Modify: `packages/database/supabase/functions/lib/scheduling/slot-allocator.ts` — operator-pool gate inside `isFree`
- Modify: `packages/database/supabase/functions/lib/scheduling/priority-calculator.ts` — dispatch-rule parameter
- Create/extend: `packages/database/supabase/functions/lib/scheduling/slot-allocator.test.ts` — DRC cases

**Steps:**

1. Extend `allocateOperation` args with:
```typescript
operatorPools?: {
  abilityId: string;
  poolSize: number;              // # eligible operators (gates + proficiency threshold applied by caller)
  reservations: { startAt: Date; endAt: Date }[]; // existing OperatorPool reservations for this ability
}[];
```
   `isFree` now also requires, for every required ability, `countOverlaps(pool.
   reservations, start, end) < pool.poolSize`. `poolSize === 0` → immediate
   conflict `"No qualified operator for <ability name>"` (distinguish from
   machine-capacity conflicts — the conflict string must name the cause:
   machine vs skill vs calendar, per spec acceptance).
   Eligibility of each employee is computed caller-side (engine) as:
   `active && trainingCompleted && (expiresAt == null || expiresAt > slotDate)
   && deriveProficiency(...) >= (minimumProficiency ?? 0)`. v1 expiry
   simplification: evaluate `expiresAt` against the operation's
   `earliestStart`, not per candidate window.
2. Successful placement records an OperatorPool reservation per required
   ability (same interval as the machine reservation, v1 whole-op duration) —
   returned alongside the WC placement for Task 18 to persist, and appended
   in-memory for subsequent ops in the run.
3. Ungated operations (no jobOperationAbility, no processAbility, no
   `workCenter.requiredAbilityId`) skip the operator gate entirely — this is the
   sparse-skill-data escape hatch.
4. Dispatch policy: `priority-calculator.ts` gains
   `dispatchRule: "FIFO" | "EDD" | "SPT" | "WSPT" | "CR" | "MinSlack"`
   (default `"EDD"`), resolved per work center from `getSchedulingPolicies()`
   (per-WC row → company default row → 'EDD'). Rule changes the sort key used
   when computing per-WC priority numbers: FIFO = createdAt; EDD = job dueDate;
   SPT = duration asc; WSPT = job.priority / duration desc; CR =
   (dueDate − now)/remaining duration asc; MinSlack = (dueDate − now −
   remaining duration) asc. Reuse the existing structure in
   `calculatePrioritiesByWorkCenter` — this changes the comparator, not the
   mechanism.
5. Tests: op requiring ability with poolSize 1 — two ops serialize even with
   parallelCapacity 2 (the DRC core assertion); poolSize 0 → skill conflict
   string; ungated op ignores pools; expired qualification excluded from pool;
   proficiency below minimum excluded; each dispatch rule orders a 3-op fixture
   correctly.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test lib/scheduling/ && deno check schedule/index.ts
# Expected: all tests pass, no type errors
```

**Out of scope:** named per-person reservations (spec explicitly chose pool
check), person calendars, tool/fixture resources.

---

## Task 18: Engine wiring — reservation lifecycle + conflict persistence

**Depends on:** Tasks 16, 17
**Files:**
- Modify: `packages/database/supabase/functions/lib/scheduling/scheduling-engine.ts` — load capacity data up front; persist reservations in `persistChanges`
- Modify: `packages/database/supabase/functions/schedule/index.ts` — no signature change; response may add `reservationsWritten` count

**Steps:**

1. In `initialize` (after work centers are known), batch-load via the provider:
   calendars, capacity overrides, live reservations for all candidate work
   centers (`excludeJobId = this.jobId`), required abilities for all ops,
   qualified employees for those abilities, and scheduling policies. Build the
   in-memory capacity/pool structures once; the allocator consumes them.
2. `persistChanges` — inside the existing per-run write path (keep it
   transactional with the jobOperation updates):
   - `DELETE FROM "capacityReservation" WHERE "jobId" = <jobId> AND "scenarioId" IS NULL AND "companyId" = <companyId>`
   - Bulk-insert the run's new reservations (WorkCenter + OperatorPool rows,
     `createdBy = userId`), skipping operations that are `manuallyScheduled`
     (their dates are untouched today — mirror that: reserve their existing
     `startDate`/`dueDate` window instead so their capacity still counts; if
     they have no dates, write no reservation).
   - `jobOperation.startDate`/`dueDate` = the allocated slot's start/end as
     dates (existing columns are DATE). `hasConflict`/`conflictReason` set from
     allocator conflicts (already existing columns + persist path).
3. Operations at Infinite work centers keep the exact current write behavior
   and get **no** reservation rows.
4. Confirm the acceptance no-regression path: a company with zero calendars
   (no shift rows existed at backfill) + no abilities + all-Finite WCs must
   still schedule: no calendar → 24×7 window; no abilities → ungated; finite
   ceiling with parallelCapacity 1 is the only behavior change, per spec intent.
   Note this in the PR description rather than adding config.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check schedule/index.ts reschedule/index.ts && deno test lib/scheduling/
# Expected: no type errors, tests pass
```

Then a live smoke (requires the dev stack running — if it is not, ask the user
to start it rather than skipping): create/reschedule a job in the ERP UI (or
call `triggerJobSchedule` path) and check:
```bash
# via psql against the local DB (read-only checks):
# SELECT count(*) FROM "capacityReservation" WHERE "jobId" = '<test job>';  -- > 0
# SELECT "hasConflict","conflictReason","startDate","dueDate" FROM "jobOperation" WHERE "jobId" = '<test job>';
```

**Out of scope:** scenario-tagged reservations, drag-to-reschedule writes from
the Gantt (phase 5).

---

## Task 19: Migration — readyAt, queue-time view, utilization table

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<generated>_ready-at-queue-time.sql` (via `pnpm db:migrate:new ready-at-queue-time`)
- Copy from (precedent): purpose-built trigger style, e.g. `set_initial_status_on_dependency` in `20250429130223_operation-dependencies.sql:92-136`; view style `WITH(SECURITY_INVOKER=true)`

**Steps:**

1. SQL:

```sql
ALTER TABLE "jobOperation" ADD COLUMN "readyAt" TIMESTAMP WITH TIME ZONE;

-- Stamp the instant an operation becomes Ready. Ready-transitions are written
-- from multiple functions (dependency triggers, finish interceptor, scheduler),
-- so a single BEFORE trigger is the one reliable point.
CREATE OR REPLACE FUNCTION set_job_operation_ready_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."status" = 'Ready' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'Ready') AND NEW."readyAt" IS NULL THEN
    NEW."readyAt" = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ready_at_on_job_operation ON "jobOperation";
CREATE TRIGGER set_ready_at_on_job_operation
BEFORE INSERT OR UPDATE OF "status" ON "jobOperation"
FOR EACH ROW EXECUTE FUNCTION set_job_operation_ready_at();

-- Queue time: Ready -> first production event
CREATE OR REPLACE VIEW "jobOperationQueueTime" WITH(SECURITY_INVOKER=true) AS
SELECT
  jo."id",
  jo."companyId",
  jo."jobId",
  jo."workCenterId",
  jo."readyAt",
  MIN(pe."startTime") AS "firstEventAt",
  EXTRACT(EPOCH FROM (MIN(pe."startTime") - jo."readyAt")) / 3600.0 AS "queueHours"
FROM "jobOperation" jo
LEFT JOIN "productionEvent" pe ON pe."jobOperationId" = jo."id"
WHERE jo."readyAt" IS NOT NULL
GROUP BY jo."id", jo."companyId", jo."jobId", jo."workCenterId", jo."readyAt";

-- Rollup target written by the Inngest cron (Task 21)
CREATE TABLE "workCenterUtilization" (
    "id" TEXT NOT NULL DEFAULT id('wcu'),
    "companyId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL REFERENCES "workCenter"("id") ON DELETE CASCADE,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "availableHours" NUMERIC NOT NULL DEFAULT 0,
    "reservedHours" NUMERIC NOT NULL DEFAULT 0,
    "actualHours" NUMERIC NOT NULL DEFAULT 0,
    "utilization" NUMERIC NOT NULL DEFAULT 0,        -- reserved / available (rho)
    "meanServiceHours" NUMERIC,
    "cvServiceTime" NUMERIC,                          -- coefficient of variation from productionEvent durations
    "avgQueueHours" NUMERIC,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "workCenterUtilization_wc_period_key"
    ON "workCenterUtilization" ("workCenterId", "periodStart", "companyId");
CREATE INDEX "workCenterUtilization_companyId_idx" ON "workCenterUtilization" ("companyId");
CREATE INDEX "workCenterUtilization_workCenterId_idx" ON "workCenterUtilization" ("workCenterId");
CREATE INDEX "workCenterUtilization_createdBy_idx" ON "workCenterUtilization" ("createdBy");
```

2. RLS on `workCenterUtilization`: four-policy block, scope `production_*`.
   (The view inherits underlying RLS via SECURITY_INVOKER.)
3. Compatibility check before finalizing: `jobOperation` participates in the
   event-system interceptor architecture — confirm plain triggers coexist
   (`set_initial_status_on_dependency` already does on jobOperationDependency).
   Grep `20260410031809_production-interceptors.sql` for jobOperation trigger
   drops; if a BEFORE trigger on jobOperation would be dropped/bypassed by that
   system, STOP and report.
4. Apply: `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: applies with no error
grep -l "workCenterUtilization" packages/database/src/*.ts | head -1
# Expected: a generated types file matches
```

**Out of scope:** backfilling `readyAt` for historical operations (impossible —
the data was never captured), VUT/Kingman UI (phase 5 lens).

---

## Task 20: Promise-date service (predictLeadTime v1)

**Depends on:** none (uses existing `jobOperation.dueDate`)
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — add `getJobPromiseDate`
- Modify: `apps/erp/app/modules/production/production.models.ts` — add the return type if a zod shape is conventional there (check; otherwise a plain exported type)

**Steps:**

1. Add:
```typescript
// v1 of the spec's predictLeadTime: promise date = scheduled finish of the
// job's last operation. Recomputed implicitly on every reschedule because it
// reads live jobOperation dates.
export async function getJobPromiseDate(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
) {
  const operations = await client
    .from("jobOperation")
    .select("id, dueDate, hasConflict")
    .eq("jobId", jobId)
    .eq("companyId", companyId)
    .in("status", ["Todo", "Waiting", "Ready", "In Progress", "Paused"]);
  if (operations.error) return operations;
  const dates = (operations.data ?? []).map((o) => o.dueDate).filter(Boolean) as string[];
  const promiseDate = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  const hasConflict = (operations.data ?? []).some((o) => o.hasConflict);
  return {
    data: { promiseDate, basis: "schedule" as const, confidence: hasConflict ? ("low" as const) : ("scheduled" as const) },
    error: null,
  };
}
```
2. Export from the production module barrel if the module uses explicit exports.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
```

**Out of scope:** displaying promise dates in the UI (phase 5 surfaces it; do
not add UI here), quoting-time lead prediction for items (spec's
`predictLeadTime(item, quantity)` variant is a later basis — this is the job
variant only), ML layer.

---

## Task 21: Inngest utilization rollup cron

**Depends on:** Tasks 13, 19
**Files:**
- Create: `packages/jobs/src/inngest/functions/scheduled/capacity-rollup.ts`
- Modify: `packages/jobs/src/inngest/functions/scheduled/index.ts` — export it
- Modify: `packages/jobs/src/inngest/index.ts` — import + add to the `functions` array
- Copy from (precedent): `packages/jobs/src/inngest/functions/scheduled/notification-digest.ts` (in-process aggregation with `step.run` phases); config shape from `scheduled/mrp.ts`

**Steps:**

1. `capacityRollupFunction = inngest.createFunction({ id: "capacity-rollup", retries: 2 }, { cron: "0 2 * * *" }, ...)` — nightly.
2. Step `"collect"`: for each company (same company-enumeration approach as
   `mrp.ts`), for the current week and next 4 ISO weeks, compute per work
   center:
   - `reservedHours` from `capacityReservation` (`resourceKind = 'WorkCenter'`,
     `scenarioId is null`) overlapping the week — clip intervals to week bounds.
   - `availableHours` from the WC's calendar (sum shift window hours × 7-day
     expansion minus Closed exceptions, × parallelCapacity) — implement a small
     TS helper here; for WCs with no calendar use 24×7 × parallelCapacity.
   - `actualHours`, `meanServiceHours`, `cvServiceTime` from completed
     `productionEvent` rows in the trailing 90 days at that WC
     (`duration` column, seconds → hours; CV = stddev/mean).
   - `avgQueueHours` from the `jobOperationQueueTime` view (trailing 90 days,
     joined on workCenterId).
3. Step `"apply"`: upsert `workCenterUtilization` rows on
   `(workCenterId, periodStart, companyId)` with `createdBy: "system"`,
   `utilization = availableHours > 0 ? reservedHours / availableHours : 0`.
4. Keep queries batched per company (one select per table per company, grouped
   in memory) — no per-work-center query loops.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
grep -n "capacityRollupFunction" packages/jobs/src/inngest/index.ts
# Expected: appears in both the import block and the functions array
```

**Out of scope:** skill-level (ability) load rollup (long-horizon outlook is a
fast-follow), any UI reading this table (phase 5 lens), Kingman VUT computation
(the inputs — rho, CV, mean service time — are what this table stores; the
formula application is UI-side in phase 5).

---

## Task 22: Docs sync (AGENTS.md + spec changelog)

**Depends on:** Tasks 1–21
**Files:**
- Modify: `apps/erp/app/modules/resources/AGENTS.md` — calendars, abilities admin, skills matrix, new tables/services (if the file exists; if a module has no AGENTS.md, skip it — do not create one from scratch in this plan)
- Modify: `apps/erp/app/modules/production/AGENTS.md` — jobOperationAbility, capacityReservation, schedulingPolicy, promise-date service
- Modify: `.ai/rules/scheduling-data-structures.md` — finite allocator, provider seam, reservations (update the sections that describe `work-center-selector.ts` behavior)
- Modify: `.ai/specs/2026-07-05-finite-capacity-scheduling.md` — changelog entry noting phases 1–4 implemented; leave the spec in `.ai/specs/` (phases 5–8 remain unimplemented, so do NOT move it to `implemented/`)

**Steps:**

1. For each file: update only sections invalidated by this work (new tables,
   new service functions, changed selector behavior). Verify every claim
   against the code you actually wrote — no aspirational statements.

**Verify:**
```bash
git diff --stat -- apps/erp/app/modules/resources/AGENTS.md apps/erp/app/modules/production/AGENTS.md .ai/rules/scheduling-data-structures.md .ai/specs/2026-07-05-finite-capacity-scheduling.md | cat
# Expected: each existing file listed with changes
```

**Out of scope:** product docs site (`docs/`) — defer until phases 5–6 make the
feature user-visible end-to-end.

---

## Task 23: Browser verification via /test

**Depends on:** all previous tasks; requires the local dev stack (`crbn up`) —
if it is not running, ask the user to start it; never rebuild the DB yourself.

**Steps:**

1. Invoke the `/test` skill against this branch's diff. Minimum flows to verify:
   - Create a resource calendar with a weekly pattern + a Closed exception; assign it to a work center; set parallelCapacity 2 / schedulingMode Finite.
   - Add a capacity override row on that work center (Task 5 drawer).
   - Create an ability with `recertifyEveryDays`; mark an employee qualified in the skills matrix; set another employee's qualification expired.
   - Put a required ability on a method operation; create/get-method a job from it; confirm the job operation shows the inherited required ability.
   - Reschedule the job (existing reschedule action) and confirm: `capacityReservation` rows exist for the job, no overbooking (two overlapping ops on a capacity-1 finite WC serialize), and an impossible requirement (ability with zero qualified operators) produces `hasConflict = true` with a skill-naming `conflictReason` — visible wherever conflicts surface today.
   - MES: attempt to start the gated operation as the unqualified employee → blocked with the flash error; as the qualified employee → starts.
2. Cache the successful playbook per the /test skill's convention.

**Expected:** every flow passes; failures loop back to the owning task.
