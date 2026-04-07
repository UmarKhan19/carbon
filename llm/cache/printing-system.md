# Printing System

## Overview

The Print Manager is a centralized print job queue at `packages/printing/` (`@carbon/printing`). Full design doc at `packages/printing/printing-integration.md`.

## Key Packages

- **@carbon/printing** (`packages/printing/`) — Print job queue, delivery, routing, document type registry, settings management, BinderyPress client
- **@carbon/documents** (`packages/documents/`) — PDF and ZPL renderers (SalesInvoicePDF, KanbanLabelPDF, ProductLabelZPL, PackingSlipPDF, etc.). The print system's built-in renderers call into this package for actual content generation.

## Architecture

Two Trigger.dev tasks:
- **print-job** (`packages/jobs/trigger/print-job.tsx`, task ID: `"print-job"`) — Content generation. Per-item streaming: for each item, creates job with `generating` status (visible immediately in Print Manager), renders content, updates job with content (→ `queued`), triggers delivery. Resolves document types from registry, fetches data, renders via built-in or BinderyPress.
- **print-job-deliver** (`packages/jobs/trigger/print-job-deliver.ts`, task ID: `"print-job-deliver"`) — Delivery. Sends content to printer via ProxyBox HTTP POST. 3 retries, timeout aborts.

## Document Type Registry

`packages/printing/src/registry.ts` — Defines `DocumentTypeDefinition` entries. Currently:
- `productLabel` — ZPL, triggered by Receipt/Shipment/Operation/Entity
- `kanbanCard` — PDF, triggered by Kanban

Adding a new type: add registry entry + data resolver + optional built-in renderer. Settings UI, routing, delivery, Print Manager all work automatically.

## Database Tables

- **printerRoute** — Printer definitions. Columns: id(pr), companyId, locationId, name, format(zpl/pdf), mediaSizeId, printerUrl, apiKey, createdAt, updatedAt. Unique on (companyId, COALESCE(locationId,''), name).
- **printJob** — Job queue + audit trail. Columns: id(pj), companyId, status(generating/queued/printing/completed/failed), contentType(zpl/pdf, nullable), content(nullable), printerUrl, sourceDocument, sourceDocumentId, sourceDocumentReadableId, description, origin(auto/manual/reprint), error, attempts, createdBy, createdAt, updatedAt, updatedBy, completedAt. Realtime-enabled.

## PrintingSettings (JSONB on companySettings.printing)

```typescript
type PrintingSettings = {
  autoPrint: { receiptLabels, shipmentLabels, kanbanCards, operationLabels } | null;
  assignments: Record<string, { printerRouteId, templateId } | null> | null;
  locationOverrides: Record<string, Record<string, string>> | null;   // locationId -> docTypeId -> routeId
  workCenterOverrides: Record<string, Record<string, string>> | null; // wcId -> docTypeId -> routeId
};
```

## Printer Route Resolution (cascading)

1. workCenterOverrides[wcId][docTypeId] → printerRouteId
2. locationOverrides[locId][docTypeId] → printerRouteId
3. assignments[docTypeId].printerRouteId (default)

Then fetches route by ID from printerRoute table.

## Module Structure (packages/printing/src/)

- `types.ts` — PrintingSettings, TemplateAssignment, PrinterRoute, PrintJob, status/origin/contentType unions
- `registry.ts` — documentTypeRegistry, DocumentTypeDefinition, getDocumentTypesForSource(), getDocumentType(), getDocumentTypeOptions()
- `service.ts` — DB functions: getPrintJobs, getPrintJob, getPrintJobContent, createPrintJob (defaults to generating status, null content), updatePrintJobContent (sets content, transitions to queued), updatePrintJobStatus, getPrinterRoutes, getPrinterRoute, upsertPrinterRoute, deletePrinterRoute, getPrintingSettings, updatePrintingSettings
- `models.ts` — Zod validators: autoPrintSettingsValidator, printerRouteValidator, assignmentSettingsValidator (dynamic from registry), locationOverrideValidator, workCenterOverrideValidator, reprintValidator
- `delivery/proxybox.ts` — sendToProxyBox() HTTP POST
- `generation/binderypress.ts` — renderWithBinderyPress() calls https://api.binderypress.dev/v1/render

## Settings UI

`apps/erp/app/routes/x+/settings+/printing.tsx` — 5 sections: Auto-Print Toggles, Printers (CRUD + test print), Template Assignments, Location Overrides, Work Center Overrides. All driven by document type registry.

## Print Manager UI

`apps/erp/app/routes/x+/print-manager.tsx` — Paginated job table, status filtering, view output (ZPL via Labelary visual preview, PDF via iframe), reprint, delete. Realtime updates via Supabase.

MES links to ERP Print Manager at `${ERP_URL}/x/print-manager`.

## Business Event Integration Points

- Receipt posting: `apps/erp/app/routes/x+/receipt+/$receiptId.post.tsx` (serviceRole, passes locationId)
- Shipment posting: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx` (serviceRole, passes locationId)
- Kanban Make/Buy: `apps/erp/app/routes/api+/kanban.$id.tsx` (serviceRole, passes locationId)
- MES serial: `apps/mes/app/routes/x+/complete.tsx` (serviceRole, passes locationId + workCenterId, uses completed entity ID)
- MES batch: same file (serviceRole, passes locationId + workCenterId)

All use 5-minute idempotency keys, nested try/catch that never blocks the parent operation.

## Cleanup

In `packages/jobs/trigger/cleanup.ts`: completed jobs > 30 days deleted, failed jobs > 90 days deleted.
