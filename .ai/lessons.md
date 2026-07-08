# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start for relevant tasks.

Format: `Context → Problem → Rule → Applies to`

---

## ioredis retryStrategy returning null kills auto-recovery

**Context:** Making the Redis client (`@carbon/kv`) resilient to outages (issue #1076).

**Problem:** A `retryStrategy` that returns `null` after N attempts (e.g. `if (times > 3) return null`) tells ioredis to **stop reconnecting permanently**. Once Redis is briefly unreachable the client gives up and every later command fails with "Connection is closed." even after Redis is healthy again — the app never recovers without a process restart. Command-level timeouts/try-catch cannot fix this; it is a connection-lifecycle setting. Unit tests with `ioredis-mock` do NOT catch it — only a real kill-and-restart test does.

**Rule:** For long-running servers, `retryStrategy` must keep reconnecting with capped backoff (`min(times * 200, 5000)`) and never return null. Bound per-command latency elsewhere (`maxRetriesPerRequest` + a timeout wrapper), not by abandoning reconnection. Verify recovery by stopping and restarting a real Redis, not just mocks.

**Applies to:** `packages/kv/src/client.ts`, `packages/kv/src/resilient.ts`, any ioredis client config.

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

## Posting-group-style matrices are a rejected pattern

**Context:** Designing multi-jurisdiction tax determination; the spec anchored on the customerType × itemPostingGroup posting-group matrix as "Carbon precedent."

**Problem:** The posting-group matrix was deliberately REMOVED (`20260229000000_drop-posting-groups.sql`) because the indirection was confusing — but the 2023 creation migration still exists, so searches find it first and it masquerades as live precedent. Anchoring a new design on it resurrects a pattern the project already rejected.

**Rule:** Do not design N×M classification-matrix configuration (party-group × item-group → outcome). Prefer flat company defaults (`accountDefault`) plus direct per-entity assignment with per-child override (the Xero model). Before citing any schema "precedent," grep for a later `DROP`/rename migration.

**Applies to:** New config/settings design anywhere; accounting/tax/posting; `.ai/specs/`, `packages/database/supabase/migrations/`.

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

## Client-side entity caches must be company-keyed in a multi-tenant app

**Context:** A prod company export failed its closure guard: a `salesOrder` (and its `opportunity`) in one company referenced another company's customer. Root cause chain: `RealtimeDataProvider` (ERP + MES) cached the customer/item/supplier/people lists in IndexedDB under **global** keys (`"customers"`), and company switching is a client-side navigation — so after a switch, the previous company's cached list could hydrate the pickers before the properly-scoped server fetch landed. Nothing downstream caught the bad pick: zod validated `customerId` as a bare string, services inserted it blindly, RLS only checks the row's own `companyId`, and the FK was single-column (`customerId → customer(id)`).

**Problem:** Any client cache (IndexedDB/localforage, localStorage, nanostores hydrated from them) that isn't keyed by `companyId` becomes a cross-tenant leak the moment a multi-company user switches companies without a full reload. Multi-company users legitimately pass RLS for both companies, so no server layer notices.

**Rule:** (1) Key every persisted client cache entry by company (`customers:${companyId}`) and guard async hydration callbacks against mid-flight company switches. (2) Tenant-scoped references between tables should be composite FKs `(refId, companyId) → parent(id, companyId)` so the DB rejects cross-company refs from every write path (see `20260703143904_composite-tenant-fks.sql`, which converts customer/supplier refs introspectively and tolerates pre-existing bad rows via NOT VALID + warning).

**Applies to:** `apps/{erp,mes}/app/components/RealtimeDataProvider.tsx`, `apps/erp/app/stores/*`, any new client-side cache; migrations adding FKs to company-scoped parents.

## Never feed a nullable user id into a NOT NULL audit column from a DB function

**Context:** A live demo failed to record production quantities, backflush materials, or complete the job. `sync_update_job_operation_quantities` auto-flipped the operation to `Done` without stamping `updatedBy`; `sync_finish_job_operation` then passed `p_new->>'updatedBy'` (NULL) as `p_user_id` into `complete_job_to_inventory`, whose `itemLedger` insert violated `createdBy NOT NULL` (23502) and rolled back the entire cascade. A sweep found the same latent bug in `sync_purchase_invoice_line_price_change` (payload `updatedBy` → NOT NULL `purchaseInvoicePriceChange.updatedBy`) — right next to a migration that had fixed the adjacent trigger for exactly this reason.

**Problem:** `updatedBy` is nullable on every table, and trigger/interceptor UPDATEs don't go through the app layer that normally stamps it. So `p_new->>'updatedBy'`, `NEW."updatedBy"`, and `p_user_id DEFAULT NULL` params are all NULL-able user sources; writing them into a NOT NULL `createdBy`/`updatedBy`/`postedBy` makes the whole transaction (including the user's original write) roll back with 23502. The failure is invisible in testing whenever the row happens to have been user-updated before.

**Rule:** In SQL functions: (1) any UPDATE issued by a trigger/interceptor that other interceptors may react to must stamp `"updatedBy"` (from the payload's `createdBy`/`updatedBy`) and `"updatedAt"`; (2) never write a payload user field into a NOT NULL column without a fallback — `COALESCE(p_new->>'updatedBy', p_new->>'createdBy')` (`createdBy` is NOT NULL on source tables); (3) functions taking `p_user_id` that write audit columns must not default it to NULL, or must guard right after `BEGIN` with a fallback to the entity's `createdBy` (see `20260706182830_fix-null-user-audit-columns.sql`). When forking a large function to add such a guard, extract the newest body verbatim (sed) and diff-verify instead of retyping.

**Applies to:** `packages/database/supabase/migrations/` — all `sync_*` interceptors and any PL/pgSQL function writing `createdBy`/`updatedBy`/`postedBy`; reviews of new event-system interceptors.

## Biome does not apply 3rd-level nested configs — enforce Deno via an override

**Context:** Bringing Supabase edge functions (`packages/database/supabase/functions/**`, Deno) into Biome's lint surface for the new `noConsole` rule. These files sit outside the linted globs (`apps/*/app/**`, `packages/*/src/**`) and were never Biome-formatted.

**Problem:** A dedicated nested `functions/biome.jsonc` (root:false, formatter off, noConsole only) is silently ignored. Biome applies the depth-1 nested config (`packages/biome.jsonc`) for the whole `packages/` subtree; a depth-2 nested config under it never governs — the `format` diagnostic keeps appearing and `formatter.enabled:false` has no effect. Letting `packages/biome.jsonc` (which `extends "//"`) govern the Deno files directly produces ~270 CI-failing errors (Deno globals → `noUndeclaredVariables`, `useImportType`, `organizeImports`, formatting) on never-linted code.

**Rule:** Do not rely on 3-level Biome config nesting. Add the target path to the depth-1 config's `files.includes`, then scope an `overrides` entry there (glob relative to that config) that turns off `formatter`/`assist` and the Node-oriented error rules (`correctness.noUndeclaredVariables`, `noUnusedVariables`, `style.useImportType`) while inheriting the one rule you want (`noConsole` as a warning). Verify with `pnpm exec biome check --reporter=summary <dir>` expecting 0 errors. See `packages/biome.jsonc`.

**Applies to:** `biome.jsonc` / `packages/biome.jsonc` rule scoping; any attempt to lint Deno edge functions or other non-`src/` trees.

## React Router v7 middleware `next()` never rejects on thrown Responses/errors

**Context:** Writing `requestIdMiddleware` (`@carbon/logger`) that sets an `x-request-id` header on the response after `await next()`, and worrying that thrown redirects/`data()` from loaders/actions would skip the header.

**Problem:** It is easy to assume `next()` propagates the thrown redirect/error (route handlers DO `throw redirect(...)`), which would mean post-`next()` response mutation is skipped on those paths. That assumption is wrong and leads to defensive try/catch that isn't needed.

**Rule:** In RR v7 middleware (`callRouteMiddleware`, react-router dist), `next()` wraps the downstream chain in try/catch and **resolves** with `errorHandler(error)`'s Response — it only rejects if `request.signal.aborted`. So mutating headers on the resolved response after `await next()` correctly covers redirects and error (500) responses; only aborted requests skip it, which is fine (client is gone). Register the middleware first so downstream runs inside its `withContext`/ALS scope.

**Applies to:** any RR v7 `middleware`/`clientMiddleware` that reads or mutates the response after `next()`; `packages/logger/src/middleware.server.ts`, `packages/auth/src/middleware/*`.
