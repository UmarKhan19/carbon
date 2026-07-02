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

## Backdated migration timestamps break remote deploys

**Context:** CI `supabase db push --include-all` failed on all remotes with `column pi.balance does not exist` while applying `20260616061244`, which recreated the `purchaseInvoices` view.

**Problem:** A migration merged with a timestamp OLDER than already-deployed migrations gets applied out of order on remotes: the remote had already run `20260630095023` (drops `purchaseInvoice.balance`), so the backdated view recreation referenced a dropped column. Worse, the newer `20260630*` batch had forked its view body from a pre-fix definition, silently reverting the backdated migration's fix (`supplierShippingCost` multiply vs divide) — the backdated migration was both broken AND dead code.

**Rule:** Never merge a migration whose timestamp is older than the newest migration already on `main`/deployed. Before writing a view/RPC recreation, fork from the NEWEST definition of that view (grep all migrations, take the last). When rescuing a failed backdated migration, strip the superseded parts and re-land the still-wanted change in a fresh forward-dated migration; don't rename already-partially-applied files (re-applies them).

**Applies to:** `packages/database/supabase/migrations/`, `ci/src/migrations.ts`, any long-lived branch adding migrations.
