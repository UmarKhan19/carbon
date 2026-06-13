# Handoff: @carbon/result — typed errors with Lingui translation

**Repo:** `D:\work\carbon` (Carbon manufacturing system: ERP, MES, Academy apps; `@carbon/*` package monorepo)
**Session type:** grill-with-docs design interview — all decisions are made and user-approved. The next session's job is **planning/implementation**, not re-litigating design.

## Authoritative artifacts (do not duplicate — read these first)

- `D:\work\carbon\docs\adr\0001-result-based-errors-with-boundary-translation.md` — the core decision, rejected alternatives, consequences
- `D:\work\carbon\CONTEXT.md` — glossary: Result vs FlashResult, Flash, Core Error, Domain Error, Conflict vs Business Rule Violation boundary rule, Greenfield Rule
- Both files exist but are **uncommitted** (untracked) as of this handoff.

## The decision set (user approved every item)

1. **Unit of adoption:** service layer (`*.service.ts`) returns `Result<T, E>`; the action/loader layer is the conversion boundary; existing flash/toast machinery stays; client layer untouched initially.
2. **Precursor rename:** `Result` type in `packages/auth/src/types.ts` (`{ success, message, flash }`) → `FlashResult`. Mechanical, repo-wide, type-position-only PR. Helpers `error()`/`success()` in `packages/auth/src/utils/result.ts` keep their names.
3. **Localization:** tagged errors carry a Lingui `MessageDescriptor` (authored with the `msg` macro — safe outside React) + serializable interpolation values. Class-level default message, optional call-site override. Translation happens at the boundary, not at creation.
4. **Package:** new `@carbon/result` in `packages/result`. Depends on and re-exports the `better-result` npm package (dmmulroy/better-result, pin the version). App code imports ONLY from `@carbon/result`, never `better-result` directly. Name `Result` is reserved for this.
5. **Taxonomy:** six core errors in `@carbon/result`: `NotFoundError`, `ValidationError`, `ConflictError`, `BusinessRuleError`, `DatabaseError`, `ExternalServiceError`. Closed set. No `PermissionError` (auth/RLS enforce upstream). Domain errors are defined next to the service that raises them, extending the same Lingui-aware TaggedError base. Boundary rule: Conflict = operation valid but current state blocks/satisfies it ("already clocked in"); BusinessRule = operation itself violates an invariant ("insufficient quantity").
6. **Adapters live in `@carbon/database`** (NOT in `@carbon/result`, which stays dependency-free): `fromQuery(query, { entity, id })` maps `PostgrestError` → `DatabaseError` and Supabase "no rows" (`.single()` / PGRST116) → `NotFoundError`; entity context is REQUIRED when NotFound is possible. Plus a Kysely transaction wrapper mapping thrown exceptions → `DatabaseError`.
7. **Boundary helper:** `errorFlash(error, i18n): FlashResult` (and `successFlash`) in `@carbon/auth`, next to flash machinery. Translates the descriptor with the request-scoped i18n at write time (requester's locale). Defects (better-result `Panic`, raw throws) deliberately bypass Result/flash → route ErrorBoundary. `@carbon/auth` gains deps on `@carbon/result` + `@lingui/core`.
8. **Adoption:** Greenfield Rule (see CONTEXT.md) + one end-to-end pilot: **approvals in `apps/erp/app/modules/shared/shared.service.ts`** (~370 lines; has textbook NotFound "Approval request not found" + Conflict "Approval request is not pending").

## Implementation order (each step independently shippable)

1. Rename `Result` → `FlashResult` (precursor PR)
2. Create `@carbon/result`: re-export better-result; Lingui-aware `TaggedError` base; six core errors; add `packages/result/src` to BOTH Lingui catalog `include` lists
3. Adapters in `@carbon/database`
4. `errorFlash`/`successFlash` in `@carbon/auth`
5. Pilot: convert approvals end-to-end; run `lingui:extract` + `translate`; verify translated toasts
6. Document Greenfield Rule in AGENTS.md

## Research findings (not captured in ADR/CONTEXT — needed for implementation)

### Current error flow
- Services return raw Supabase responses `{ data, error }`; routes check `result.error` then `throw redirect(path, await flash(request, error(result.error, "Failed to X")))` → toast. English message born in the route file, never translated.
- Flash machinery: `packages/auth/src/services/session.server.ts` (`flash()`), `packages/auth/src/middleware/flash.server.ts`. Form errors: `validationError()` in `packages/form/src/server.ts` (422) — unaffected by this work.
- ~20 service files (16 ERP + 4 MES). Largest: settings (1260 lines), invoicing (1016), people (797), production (~850).
- Only 3 existing custom Error classes, all in `packages/ee/src/accounting/core/utils.ts` (`RatelimitError`, `NotImplementedError`, `AccountingApiError` with `getUserMessage()`) — precedent for domain-errors-near-usage.
- Services today inconsistently signal NotFound: some `{ error: { message: "X not found" } }`, some `new Error(...)`, some raw PostgrestError passthrough.

### Lingui setup
- Root `lingui.config.js`: 11 locales (en source; es, de, it, ja, zh, fr, pl, pt, ru, hi), PO format, two catalogs (`erp`, `mes`) at `packages/locale/locales/{locale}/{erp,mes}`.
- Catalog includes: `apps/{erp|mes}/app`, `packages/react/src`, `packages/form/src`, `packages/printing/src/ui`. Excludes `**/*.server.*`, tests. NOTE: `*.service.ts` files ARE in scope (not excluded); `packages/result/src` must be ADDED to both catalogs.
- Origin refs / POT-Creation-Date are stripped post-extract by `scripts/strip-po-headers.mjs` to reduce diff churn.
- npm scripts: `lingui:extract`, `lingui:compile`, `lingui:clean`, `translate`.
- Server-side per-request i18n: `apps/erp/app/services/lingui.server.ts` (lazy compiled-catalog import via `import.meta.glob`); locale via `locale` cookie, `resolveLanguage()` in `packages/locale/src/config.ts`, `DEFAULT_LANGUAGE` env.
- CRITICAL (from llm/cache): never import `t` from `@lingui/core/macro` in app code (SSR crash); use context-bound `useLingui()` in components. The `msg` macro (descriptor-only, no translation) is the pattern for error classes.

### better-result API (verified from README)
- Exports: `Result` (ok/err/try/tryPromise/gen/await), `TaggedError("Name")<{fields}>()` factory producing `_tag`-discriminated classes, `Panic`, `UnhandledException`, type helpers `InferOk`/`InferErr`/`SerializedResult`.
- Methods: `map`, `mapError`, `andThen(+Async)`, `match({ok, err})`, `unwrap(Or)`, `tap`/`tapError`(+Async), `tryRecover(+Async)`, retry config on `tryPromise`.
- Caveat established in session: TaggedError instances do NOT survive `json()` round-trips as class instances — one reason Results stop at the action boundary.

## Project conventions that bind this work (from AGENTS.md + user memory)

- ALWAYS query `llm/cache/` via subagents before exploring code; update cache only about committed code.
- Migrations workflow in `llm/workflows/` (not needed here — no DB changes).
- Commits: NO `Co-Authored-By`, never `--no-verify`. Never stage `packages/dev`, `packages/auth`... — CAUTION: the staging-rules memory was about a different task (picking lists); confirm with user what to stage for this work. Never stage `package.json`, `.npmrc`, `docker-compose.dev.yml` (currently dirty in worktree, untouched by this session).
- Never rebuild the database to test; user does that.
- Pre-existing dirty files in the worktree (`.npmrc`, `docker-compose.dev.yml`, two migrations, `packages/dev/*`, kong.yml) are unrelated — do not stage or revert.

## Suggested skills for the next session

- `/plan` — turn the implementation order above into a step-by-step task plan (user's repo has this skill; tasks of 2–5 min with exact code)
- `/execute` — run the plan task-by-task with verification and frequent commits
- `superpowers:test-driven-development` or `/tdd` — for `@carbon/result` core + adapters (pure logic, ideal for TDD; repo uses Vitest via `@carbon/config`)
- `/forms` — only if the pilot touches ValidatedForm action handlers
- `/code-review` or `superpowers:requesting-code-review` — before opening the pilot PR
- `/login` + `/test` — browser-verify the pilot's translated toasts (ERP dev server :3000), with user permission

## Open items (small, decide during planning)

- Exact `TaggedError` base extension mechanics: how the Lingui descriptor + values attach (wrap better-result's factory vs a `CarbonError` subclass layer) — design intent is fixed, mechanism is implementer's choice.
- `fromQuery` exact signature/overloads (e.g. list queries that can't NotFound shouldn't require entity context).
- Whether `errorFlash` also logs (today's `error()` helper logs via console) — preserve parity.
- Pinned `better-result` version + ESM/TS compatibility check against the monorepo build (`@carbon/config`).


  ┌─────────────────────────────────────────────────────────────────┐
  │ @carbon/result          (leaf — depends on nothing internal)    │
  │   Result<T,E> (re-exported better-result)                       │
  │   TaggedError base — carries a Lingui MessageDescriptor         │
  │   the six Core Errors (NotFound, Validation, Conflict,          │
  │   BusinessRule, Database, ExternalService)                      │
  └──────────────┬──────────────────────────────────────────────────┘
                 │ imported by everything below
  ┌──────────────▼──────────────────────────────────────────────────┐
  │ @carbon/database — the Adapters                                 │
  │   fromQuery(query, {entity, id}) → Result<T, NotFound|Database> │
  │   transaction wrapper: thrown Kysely errors → DatabaseError     │
  └──────────────┬──────────────────────────────────────────────────┘
                 │ called by
  ┌──────────────▼──────────────────────────────────────────────────┐
  │ SERVICE LAYER (the unit of adoption — 20 files)                 │
  │   apps/erp/app/modules/*/x.service.ts, apps/mes/app/services    │
  │   Domain Errors defined here, next to the service               │
  │   returns Result; Conflict vs BusinessRule per glossary rule    │
  └──────────────┬──────────────────────────────────────────────────┘
                 │ Result flows up to
  ┌──────────────▼──────────────────────────────────────────────────┐
  │ ACTION LAYER (the conversion boundary — hundreds of routes)     │
  │   match on Result → errorFlash(error, i18n) → FlashResult       │
  │   (errorFlash lives in @carbon/auth, next to Flash machinery)   │
  │   translation happens HERE, write-time, requester's locale      │
  │   defects (Panic / raw throws) bypass all this → ErrorBoundary  │
  └──────────────┬──────────────────────────────────────────────────┘
                 │ Flash cookie
  ┌──────────────▼──────────────────────────────────────────────────┐
  │ CLIENT — toast renders the already-translated FlashResult       │
  │   (client-side errors keep using t`` macros directly)           │
  └─────────────────────────────────────────────────────────────────┘

  sideline: @carbon/locale — catalogs (erp.po / mes.po × 11 locales);
  lingui extract scans @carbon/result + module code for msg descriptors;
  apps build the per-request i18n that errorFlash consumes