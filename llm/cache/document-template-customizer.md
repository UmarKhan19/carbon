# Document Template Customizer

Lets users customize the built-in PDF documents (reorder/hide sections, add
extension blocks, theme colors, fonts, page header/footer) with a live preview.
Editor lives at `apps/erp/app/routes/x+/templates+/`.

## Supported documents

`documentTemplateTypeSchema` enum (`packages/documents/src/template/schema.ts`)
and `DOCUMENT_CATALOG` (`defaults.ts`, `supported: true`) currently cover all 8:
salesInvoice, salesOrder, purchaseOrder, quote (transactional); packingSlip
(fulfillment); stockTransfer (transfer); jobTraveler, issue (Phase C).

## Template model (`packages/documents/src/template/`)

- **schema.ts** — zod. `blockSchema` is a discriminated union keyed on `type`.
  Built-in blocks (`builtInBlock("…")`) carry only `id`+`visible`; some carry
  `options` (header logo/fields, lineItems thumbnails/zebra, summary taxLabel).
  Extension blocks: `richText`, `keyValue`, `spacer`, `shared`, `customField`.
  `documentSettingsSchema` = fontFamily + footer page-numbers/format +
  registration line. `documentTemplateSchema` = blocks + theme + settings +
  header/footerSectionId.
- **defaults.ts** — `BLOCK_META` (label/isBuiltIn/removable/hideable/addable per
  block type — **every** block type must have an entry), default block-list
  helpers (`transactionalBlocks`/`fulfillmentBlocks`/`transferBlocks`/
  `jobTravelerBlocks`/`issueBlocks`), `DEFAULT_TEMPLATES` (one per doc type),
  `resolveTemplate(type, stored)` (falls back to default, appends missing
  built-ins hidden), `BUILT_IN_SECTIONS` (system-header/footer, id
  `BUILT_IN_SECTION_IDS`), `collectSectionIds`, `DOCUMENT_CATALOG`,
  `getDocumentLabel`.
- **merge.ts** — `MERGE_FIELDS[docType]` `{{token}}` catalog; `interpolateContent`
  / `interpolateString` fill header/footer/richText/keyValue at render.

## Per-doc PDF architecture (`packages/documents/src/pdf/`)

Each supported doc is a **thin driver** + a **per-doc block registry**:

- `<Doc>PDF.tsx` — resolves the template, builds a `<Doc>Data` bag + merge
  `vars`, computes header/footer section content, then renders
  `<Template …chrome>{visibleBlocks.map(registry[block.type])}</Template>`.
  Pattern reference: `StockTransferPDF.tsx`.
- `pdf/blocks/<doc>/` — `types.ts` (`<Doc>Data` + `BlockRenderer`), `vars.ts`
  (`build<Doc>Vars`), one component per block, `registry.tsx`
  (`Record<DocumentBlockType, BlockRenderer>` — **must have a key for every
  block type**; unused → `() => null`), `index.ts`. Extension-block renderers
  reuse the generic `pdf/blocks/{RichText,KeyValue,Spacer,Shared,CustomField}Block`.
- `pdf/components/Template.tsx` — `<Document><Page>` chrome: fixed header-section
  banner, body, `Footer` (page numbers + registration line + footer-section).
- `preview-documents.tsx` — `DOCUMENT_PDFS[type] = { Component, sample }` dispatch
  for the generic preview route. `pdf/index.ts` re-exports PDFs + `SAMPLE_*`.
- `pdf/<doc>.samples.ts` — `SAMPLE_*` fixture (cast `as any`) for preview.

**Adding a block type** to the union breaks every existing registry (they are
`Record<DocumentBlockType,…>`) → add the new key (usually `() => null`) to all
registries + a `BLOCK_META` entry.

## Job Traveler specifics

Multi-make-method: the route
`apps/erp/app/routes/file+/job+/$jobId.traveler[.]pdf.tsx` renders **multiple
`<Page>`** (one per make method), each with `JobTravelerPageContent` (the
block-driven body, exported from `JobTravelerPDF.tsx`) + its own `Footer`. The
single-page `JobTravelerPDF` default export wraps the same body in `Template`
and is what the editor **preview** uses.

## Editor (`apps/erp/app/components/DocumentTemplateEditor/`)

`context.tsx` (state/actions provider), `index.tsx` (rails + toolbar; toolbar has
a centered `Combobox` to preview against a live record), `BlockList`/`BlockConfig`
/`FontConfig`/`ThemeConfig`/`SectionFormModal`/`TemplatePreview`/`NumberRow`.
`NumberRow` wraps react-aria `NumberField` with the required composed
`NumberInputGroup` child (a bare `label` prop renders no input).

## Routes / persistence

- `x+/templates+/$type.tsx` — loader resolves template + sections + customFields +
  `listPreviewEntities`; action upserts via `upsertDocumentTemplate`.
- `x+/templates+/$type.preview.tsx` — POST renders draft layout via
  `DOCUMENT_PDFS`; with a `previewId`, `buildPreviewProps`
  (`modules/settings/documentPreview.server.ts`) renders against real record data
  (supported: salesInvoice/salesOrder/purchaseOrder/quote/stockTransfer; others
  fall back to sample).
- File routes (`file+/<doc>+/…pdf.tsx`) — load `getDocumentTemplate`, build a
  `DocumentTemplate | null`, `resolveTemplate`, `resolveSections`,
  `ensureFont(settings.fontFamily)`, pass `template` + `sections` to the PDF.
- `modules/settings/settings.service.ts` — `getDocumentTemplate`,
  `upsertDocumentTemplate`, `getDocumentSections`, `resolveSections`,
  `upsertDocumentSection` (forks built-in sections on edit). DB tables:
  `documentTemplate`, `documentSection`.

> Note: `documentTemplate` rows are typed loosely until the generated DB types
> are regenerated — PDF routes cast `data.blocks/theme/settings` (`.blocks does
> not exist on ResultOne` tsgo errors are expected until regen).
