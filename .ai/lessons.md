# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start for relevant tasks.

Format: `Context → Problem → Rule → Applies to`

---

## Permission scope renames are invisible to typecheck

**Context:** Renaming DB RLS policies (e.g., `plm_*` → `production_*`) as part of a module rename.

**Problem:** The app layer's `requirePermissions()` and `permissions.can()` calls use string literals like `"plm"`. These are invisible to TypeScript's type checker and linter — the rename passes all automated checks but 403s every route at runtime.

**Rule:** When renaming permission scopes, grep the ENTIRE codebase for all string literal references, not just the DB layer. Check `requirePermissions`, `permissions.can`, `usePermissions`, route loaders, and any conditional UI gating.

**Applies to:** Any permission or scope rename, `apps/erp/app/routes/`, `apps/erp/app/modules/`.

## Multi-tenancy: every query must scope by companyId

**Context:** Writing service functions that query the database.

**Problem:** Forgetting to include `.eq("companyId", companyId)` in a query exposes cross-tenant data. RLS provides a safety net, but defense in depth requires application-level scoping too.

**Rule:** Every database query in a service function MUST include `companyId` scoping. Never rely solely on RLS for tenant isolation — treat it as a backup, not the primary guard.

**Applies to:** All `*.service.ts` files, any Kysely or Supabase query.

## ValidatedForm needs the validator, not the raw schema

**Context:** Building forms with zod validation.

**Problem:** Passing a raw zod schema to `ValidatedForm` instead of wrapping it with `validator()` from `@carbon/form` results in silent validation failures — the form submits without client-side validation.

**Rule:** Always use `validator(schema)` from `@carbon/form`, not the raw zod schema. Validate with `validator(schema).validate(formData)`, not `schema.parse()`.

**Applies to:** All forms in `apps/erp/app/routes/`, `packages/form/`.

## Features live inside existing permission modules

**Context:** Building a new feature that belongs to an existing domain (e.g., assembly instructions within production).

**Problem:** Creating a standalone module enum value / permission family (`Assembly` module with `assembly_*` permissions) for something that is really part of an existing domain. Assembly instructions belong to **production**, governed by `production_<view|create|update|delete>`.

**Rule:** Don't invent a new module/permission family for a feature that fits an existing domain. Add a sub-link in the existing sidebar group (like Procedures) and a full-screen editor in its own route tree (`x+/assembly+/$id`, `handle.module: "production"`, mirroring `x+/procedure+/`). Pattern: list route under `x+/<module>+/<plural>.tsx`, full-screen editor in a sibling `x+/<singular>+/` tree whose `_layout.tsx` declares the parent module. Module folder = permission module = nav module.

**Applies to:** New features under `apps/erp/app/routes/x+/`, `apps/erp/app/modules/`.

## Assembly viewer camera + animation principles

**Context:** Camera transitions and part-motion animation in the assembly instruction viewer (`packages/viewer`).

**Problem:** Per-step re-zooming and pure-geometry view heuristics lose the "where are we on the model" context; small fasteners are invisible at assembly scale; sparse path sampling produced false "removable" results (washer/bolt ordering bugs).

**Rule (user directives):**
- **Constant zoom, rotate-only:** per-step camera transitions keep the standing whole-assembly distance and only rotate toward the action — never re-zoom per step or frame a single small part tightly.
- **Occlusion-aware angles:** choose view direction by scoring how many parts block the line of sight to the animated part (seated pose + travel midpoint), not by pure geometry heuristics.
- **Exaggerate small parts:** bolts/washers get display-only exaggerated travel (>=2.5x their size) so insertions read at assembly scale.
- **Manual motion editing is a 0.001% escape hatch:** keep it collapsed behind "Edit manually"; motions come from the geometry planner.
- **Planner correctness beats coverage:** cap sample spacing (2mm) rather than sample count. Threaded fasteners need a thread-depth penetration allowance along their own axis because CAD models them as interfering solid cylinders.

**Applies to:** `packages/viewer/`, geometry planner (`services/geometry`).

## Backdated migration timestamps break remote deploys

**Context:** CI `supabase db push --include-all` failed on all remotes with `column pi.balance does not exist` while applying `20260616061244`, which recreated the `purchaseInvoices` view.

**Problem:** A migration merged with a timestamp OLDER than already-deployed migrations gets applied out of order on remotes: the remote had already run `20260630095023` (drops `purchaseInvoice.balance`), so the backdated view recreation referenced a dropped column. Worse, the newer `20260630*` batch had forked its view body from a pre-fix definition, silently reverting the backdated migration's fix (`supplierShippingCost` multiply vs divide) — the backdated migration was both broken AND dead code.

**Rule:** Never merge a migration whose timestamp is older than the newest migration already on `main`/deployed. Before writing a view/RPC recreation, fork from the NEWEST definition of that view (grep all migrations, take the last). When rescuing a failed backdated migration, strip the superseded parts and re-land the still-wanted change in a fresh forward-dated migration; don't rename already-partially-applied files (re-applies them).

**Applies to:** `packages/database/supabase/migrations/`, `ci/src/migrations.ts`, any long-lived branch adding migrations.

## Never resolve a control account by number/name

**Context:** Posting intercompany invoices/payments needed the "Inter-Company Receivables" control account. The edge functions (`post-sales-invoice`, `post-payment`) fetched it with `.eq("number", "1130")`.

**Problem:** Account `number` and `name` are user-editable at any time. Resolving a control account by a hardcoded number silently mis-posts the moment someone renumbers/renames the account — no error, wrong GL account. It also duplicates a magic constant across posting paths that can drift.

**Rule:** Resolve internal/control accounts by **id** via a column on `accountDefault` scoped to the `companyId` (the same pattern as `receivablesAccount`/`payablesAccount`). If no default column exists, add one to `accountDefault` (+ seed it in `seed.data.ts` and `seed-company`, + one-time backfill migration resolving the seeded number → id), then read `ad.<xxx>Account`. The only legitimate uses of `.where("number"/"eq("number")` on `account` are: building the chart at seed time, and mapping **external** codes in an integration (e.g. Xero AccountCodes) — never resolving an internal control account at posting time.

**Applies to:** `packages/database/supabase/functions/post-*`, `close-job`, `issue`, anything posting to `journalLine`; `accountDefault` schema + `lib/seed.data.ts`.

## Chart-of-accounts group headers have no number — resolve parents by name/key

**Context:** `20260524143827_fixed-assets.sql` seeded a "Deferred Tax Expense" (7090) account for every existing company group, resolving its parent with `number = '7000' AND "isGroup" = true`.

**Problem:** Group header accounts in Carbon's chart carry `number = NULL` (they are identified by seed key/name, e.g. `other-expenses` / "Other Expenses") — only leaf posting accounts have numbers. The lookup silently returned NULL and the account was inserted with `parentId = NULL`, leaving it orphaned at the root of the chart for every pre-existing company. New companies were unaffected because `seed.data.ts` parents via `parentKey`. The bug is invisible in dev (fresh seeds go through `seed.data.ts`) and only shows on long-lived databases.

**Rule:** In migrations that insert `account` rows, resolve the parent group by `"isGroup" = TRUE AND name = '<Group Name>'` (optionally + class), never by number — and treat a NULL parent as an error or explicit fallback, never insert silently orphaned. `20260630093809_ar-ap-payments.sql` is the correct precedent. When a past migration did orphan accounts, ship a follow-up UPDATE re-parenting `parentId IS NULL` rows to the group `seed.data.ts` assigns (see `20260702192816`).

**Applies to:** `packages/database/supabase/migrations/` touching `account`; `packages/database/supabase/functions/lib/seed.data.ts`; anything walking the chart-of-accounts tree.

## Never fabricate a "best-effort" motion through geometry

**Context:** The assembly motion planner (`services/geometry/app/plan.py`) had a tier-4 "forced removal" that gave unsolvable parts a straight-line motion through whatever blocked them, so every part animated. On the seat-rail assembly 6/30 parts got 48–647mm fly-through motions early in the sequence — the whole animation read as wrecked.

**Problem:** A fabricated path is worse than no path: it renders as a collision, erodes trust in every other step, and hides the real geometric finding (interlocked unit, embedded solid, missing mate exemption) behind a fake answer.

**Rule:** When a solver can't prove a result, emit an explicit flagged state (`motion: "none"` + `blockedBy` + warning) and give the UI a degraded-but-honest rendering (fade-in at the seated pose). Never ship a fabricated approximation of a geometric/physical claim. Same for display fallbacks: an AABB "least-blocked direction" guess may only be used where it's labeled as a guess, never silently for planner output.

**Applies to:** `services/geometry/app/plan.py`, `packages/viewer` (fallback.ts, AssemblyPlayer), `generateAssemblyStepsFromPlan`.

## Penetration tolerances must stay far below sample spacing

**Context:** The planner allowed 1.5mm "thread depth" penetration along a fastener's axis versus ALL parts, with collision samples every 2.0mm, to make solid-thread models removable through their nuts.

**Problem:** Tolerance ≈ spacing means a thin blocker (1mm washer, flange, cover) can pass between samples entirely below the allowance — the part "removes" through solid metal, which scrambles the greedy disassembly order downstream. A blanket allowance also applies to parts that have nothing to do with the threads.

**Rule:** Scope allowances to the specific mating pair that justifies them (fastener ↔ its detected threaded mate, capped at the seated interference + margin), keep the global tolerance an order of magnitude below sample spacing, and locally refine sampling near any contact that approaches the tolerance.

**Applies to:** `services/geometry/app/plan.py` collision sampling; any sampled sweep/clearance check.

## trimesh CollisionManager rebuilds BVHs on every single-object query

**Context:** Re-planning the 31-part seat rail took ~2 hours; the old planner took ~59s. `manager.in_collision_single(mesh, transform)` builds a fresh FCL BVH for the queried mesh on EVERY call, and the greedy loop also removed/re-added parts per attempt (another BVH rebuild each).

**Rule:** For sampled sweeps, cache the FCL BVH per mesh (`mesh_to_BVH` once, `fcl.CollisionObject` per query) and collide against `manager._manager` directly; never remove/re-add a manager object to "exclude" it — filter its contacts by name with an infinite allowance instead. Bound sampling by the AABB separation distance (beyond it, disjointness is provable).

**Applies to:** `services/geometry/app/plan.py` (`_contacts_at`, `_self_exempt`), any trimesh/fcl sampling loop.

## Don't pre-sign a short-lived upload URL before a long-running operation

**Context:** `assembly-plan` pre-signed a `createSignedUploadUrl` for `plan.json`, then called the geometry `/plan` service which ran the motion planner (~3 min) and finally PUT the result to that URL. Uploads 400'd and the job stuck in `Processing` forever; the ERP UI polled "Solving motions…" indefinitely.

**Problem:** Supabase `createSignedUploadUrl` mints a **60-second** token and the SDK gives no way to extend it (it only honors `{ upsert }`; the TTL is a storage-server setting). By the time a multi-minute planner finished, the token had expired → `400 InvalidJWT "exp claim timestamp check failed"` → the service returned 502. The fast `/convert` path (~16s) never tripped it, so the pattern looked fine. Re-runs/"already exists" are a red herring — an upsert PUT to an existing object returns 200.

**Rule:** A pre-signed **upload** URL must be consumed within ~60s of minting. For any operation that can outlast that, don't hand the worker a pre-signed PUT URL — have the service **return the artifact inline** and let the worker persist it with the service-role client the moment it has the bytes (no token, no expiry). Also bound the outbound `fetch` with `AbortSignal.timeout(...)` so a hung service fails cleanly (→ `onFailure` marks the row Failed) instead of pinning it in `Processing`.

**Applies to:** `packages/jobs/src/inngest/functions/tasks/assembly-plan.ts`, `services/geometry/app/main.py` (`/plan`); any Inngest task that pre-signs storage upload URLs before a slow external call.

## Direct psql DDL needs a PostgREST schema-cache reload

**Context:** Applied an unshipped migration's delta (drop `assemblyGroup`, create `assemblyUnit`) to the local DB with `psql` instead of `crbn migrate`, to avoid a full rebuild. The ERP page then hung: the `$id` loader's `Promise.all` timed out (`fetchWithRetry` TimeoutError) even on queries against unrelated tables.

**Problem:** PostgREST caches the DB schema. `crbn migrate` / `db:migrate` reload it after applying migrations; a raw `psql` DDL does not. With a stale cache, queries against the changed tables can't resolve and hang, which exhausts the connection pool and times out *other* queries too. (Confirmed after: `assemblyGroup` returned PGRST205 "Could not find the table in the schema cache".)

**Rule:** After any direct-psql schema change to a local Supabase DB, reload PostgREST — `psql -c "NOTIFY pgrst, 'reload schema';"` (or `docker restart <...>-postgrest-1`). Prefer `crbn migrate` when possible; when patching by hand (e.g. editing an unshipped migration in place), the reload is a required follow-up.

**Applies to:** any local schema change applied outside `crbn migrate`; symptom is loader/REST timeouts after a DDL patch.
