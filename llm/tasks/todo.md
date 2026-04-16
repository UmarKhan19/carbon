# MES Translations

## Infrastructure

- [x] Update `lingui.config.js` with MES catalog entry
- [x] Create `apps/mes/app/services/lingui.server.ts`
- [x] Wire up `LocaleProvider` in `apps/mes/app/root.tsx`

## Wrap MES strings with lingui macros

- [x] Components batch 1: AppSidebar, AdjustInventory, EndShift, Suggestion, TimeCardButton, TimeCardWarning, ConsolePill, PinInOverlay
- [x] Components batch 2: Feedback, SearchFilter, OperationsList, FilePreview, FileDropzone, Hyperlink, Filter/Filter, Filter/ActiveFilters
- [x] Components batch 3: JobOperation, Controls, Parameter, ScrapReason, SerialSelectorModal, Step, Chat, QuantityModal, TableSkeleton
- [x] Components batch 4: Kanban, ColumnCard, ItemCard, MaintenanceOeeImpact, MaintenanceSeverity, MaintenanceAddPartModal
- [x] Routes batch 1: \_layout, \_index, active, assigned, complete, operations, recent, rework, maintenance
- [x] Routes batch 2: event, feedback, finish, scrap, issue, record, record.delete, start, end, steps.inspection (all server-side only, skipped)
- [x] Routes batch 3: timecard, location, acknowledge, console._, adjustment, dispatch._, entity.\*, unconsume, maintenance-event, issue-tracked-entity
- [x] Routes batch 4: login, \_public/\_layout

## Extract and translate

- [x] Run `lingui extract` to generate .po source files
- [x] Create translated .po files for all 10 languages (en, es, de, it, ja, zh, fr, pl, pt, ru)
- [x] Run `lingui compile` to verify

## Review

- [x] Verify no hardcoded English strings remain

## Security Review

- [x] Review cached security context and identify likely high-risk auth/data-isolation boundaries
- [x] Trace request authentication and authorization entry points, including session, API key, and company-context handling
- [x] Review privileged database access, service-role usage, RLS policies, and edge/server functions for tenant breakout or sensitive-data exposure paths
- [x] Sample high-risk routes/features for object-level authorization gaps and unsafe direct object references
- [x] Verify findings with targeted evidence and summarize exploitability, impact, and gaps

## Review

- [x] Confirm each finding includes severity, affected path, evidence, and a safe reproduction description
- [x] Document residual risk where code paths could not be fully exercised locally

## Security Remediation Plan

- [ ] Define a standard authorization pattern for service-role handlers: authenticate caller, verify module permission, verify object-level access, then perform privileged query or mutation
- [ ] Inventory current `bypassRls: true` and direct `getCarbonServiceRole()` request paths and group them by reusable authorization shape
- [ ] Add shared authorization helpers for common object scopes such as operation, job, tracked entity, quality document, dispatch item, and file path
- [ ] Update highest-risk MES and ERP routes to verify company and object ownership before any service-role access
- [x] Fix claim caching so company-specific role and permission data cannot bleed across company contexts
- [x] Replace or harden console impersonation state so effective-user selection is server-validated and tamper resistant
- [ ] Add route-level tests covering cross-object and cross-company access attempts for each privileged handler
- [ ] Add review guidance for future service-role usage so new handlers require explicit authorization proof before merge

## Things To Test

- [x] Permission cache respects company boundaries when switching companies
- [x] MES operation routes deny non-employees and cross-company operation IDs
- [x] Console pin cookie tampering is rejected
- [ ] Console mode falls back safely when pinned employee is inactive or removed from company
- [ ] ERP quality document route denies cross-company or unknown document IDs
- [ ] ERP job batch route denies tracked entities outside the selected job/company
- [ ] Existing in-company quality document loads still work
- [ ] Existing in-company job batch updates still work
- [ ] MES record route denies step IDs outside the selected company
- [ ] MES start route denies cross-company operation IDs
- [ ] MES end route denies cross-company operation IDs
- [ ] Existing in-company MES record/start/end flows still work
- [ ] MES issue route denies cross-company operation/material/item IDs
- [ ] MES scrap route denies cross-company operation IDs
- [ ] MES rework route denies cross-company operation IDs
- [ ] MES event route denies cross-company operation/event IDs
- [ ] MES convert/scrap/unconsume tracked-entity routes deny cross-company entity/material IDs
- [ ] Existing in-company MES issue/scrap/rework/event/entity flows still work
- [ ] MES maintenance event route denies cross-company dispatch/event IDs
- [ ] MES maintenance dispatch item routes deny cross-company dispatch/item/entity IDs
- [ ] Existing in-company MES maintenance dispatch/event flows still work
- [ ] MES inventory adjustment route denies cross-company item/location/shelf IDs
- [ ] Existing in-company MES inventory adjustments still work
