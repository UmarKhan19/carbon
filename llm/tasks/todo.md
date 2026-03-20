# Task Plan

## Current Tasks

- [x] Write database migration SQL (20260320023847_method-type-migration.sql)
- [x] Update TypeScript shared types and models (shared.models.ts, imports.models.ts, types.ts, swagger-docs-schema.ts)
- [x] Add replenishment gating domain validation (validMethodTypesByReplenishment, getValidMethodTypes)
- [x] Update edge functions (mrp, get-method, convert, create, recalculate, issue, post-sales-invoice, sync, scheduling-engine, methods.ts)
- [x] Update UI components (Icons.tsx, DefaultMethodType.tsx, all forms/tables/properties/routes)
- [x] Audit integrations and fix remaining references (paperless-parts, onshape, quote-configurator, examples)

## Review

- Migration rewrites Buy->Purchase to Order, Pick->Pull from Inventory, Make->Make to Order in all 6 tables
- Migration drops and recreates methodType enum with 6 values (removes old 3, adds new 6)
- All SQL functions recreated: get_method_tree, get_job_methods_by_method_id, get_job_method, get_quote_methods_by_method_id, get_quote_methods, get_job_quantity_on_hand
- SQL views recreated: openSalesOrderLines, openJobMaterialLines
- replenishmentSystem values (Buy, Make, Buy and Make) intentionally NOT changed
- Test failures are pre-existing (tiptap has no tests, CI test runner has missing file)
