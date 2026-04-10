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
- [x] Routes batch 1: _layout, _index, active, assigned, complete, operations, recent, rework, maintenance
- [x] Routes batch 2: event, feedback, finish, scrap, issue, record, record.delete, start, end, steps.inspection (all server-side only, skipped)
- [x] Routes batch 3: timecard, location, acknowledge, console.*, adjustment, dispatch.*, entity.*, unconsume, maintenance-event, issue-tracked-entity
- [x] Routes batch 4: login, _public/_layout

## Extract and translate
- [x] Run `lingui extract` to generate .po source files
- [x] Create translated .po files for all 10 languages (en, es, de, it, ja, zh, fr, pl, pt, ru)
- [x] Run `lingui compile` to verify

## Review
- [x] Verify no hardcoded English strings remain
