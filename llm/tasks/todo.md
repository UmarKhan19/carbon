# Fix Lingui SSR crash ("Attempted to call a translation function without setting a locale")

## Root cause

19 ERP route files use the `t` macro from `@lingui/core/macro` at render time. That macro
compiles to `i18n._()` on the **global** i18n singleton from `@lingui/core`, which is never
activated anywhere (server or client) — only `LocaleProvider`'s context-scoped instance
(`packages/locale/src/i18n.tsx`) is activated. SSR on Vercel crashes when rendering any of
these routes (user hit it on /x/settings/company). `msg` descriptors in `handle` exports and
`<Trans>` components are unaffected (descriptor-only / context-bound).

## Fix

Replace render-time global `t` with the context-bound `t` from `useLingui()`
(`@lingui/react/macro`) — the pattern already used by ~dozens of components
(e.g. apps/erp/app/components/Breadcrumb.tsx).

## Tasks

- [x] Convert batch 1: settings/company, settings/billing, settings/labels, settings/production, settings/quality (Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.)
- [x] Convert batch 2: settings/sales, settings/purchasing, settings/inventory, settings/resources, quality/_index (same cache rule)
- [x] Convert batch 3: tool/$itemId, part/$itemId, issue/$id, traceability/_index, users/operators (same cache rule)
- [x] Convert batch 4: schedule/dates, schedule/operations, resources/assignments, resources/assignments.$trainingId (same cache rule)
- [x] Verify: no remaining render-time `t` from @lingui/core/macro in apps; spot-check diffs (same cache rule)

## Review

- The initial grep was over-broad: it flagged 19 files, but 18 of them already used the
  context-bound `const { t } = useLingui()` pattern (converted in an earlier migration) and
  only imported `msg` from core/macro. **Only `settings+/company.tsx` still imported `t`
  from `@lingui/core/macro`** — the one route the user reported.
- Fix applied (single file, apps/erp/app/routes/x+/settings+/company.tsx): import `msg`
  only from `@lingui/core/macro`, add `useLingui` to the `@lingui/react/macro` import, and
  add `const { t } = useLingui();` at the top of the `Company` component (its one `t` usage
  is the copy-button aria-label).
- Verified by grep: no file in `apps/` or `packages/` imports `t` from
  `@lingui/core/macro` anymore.
- Not run here: production SSR repro (needs a deploy/build); the failure mode is fully
  explained by the stack trace (`I18n._` on the never-activated global singleton during
  react-dom-server render).
