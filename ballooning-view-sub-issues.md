# Ballooning View Sub-Issues

## Context

Current ballooning diagrams are stored in `qualityDocument` with the `ballooning` tag. Balloon annotations and feature rows are currently persisted inside `qualityDocument.content` as JSON arrays (`annotations` and `features`).

Relevant files:
- `apps/erp/app/modules/quality/quality.service.ts`
- `apps/erp/app/modules/quality/quality.models.ts`
- `apps/erp/app/modules/quality/types.ts`
- `apps/erp/app/modules/quality/ui/Ballooning/BalloonDiagramEditor.tsx`

## 1. Dedicated table for ballooning data

Goal: store per-balloon data in a relational table associated with a ballooning diagram record instead of embedding everything in a parent JSON blob.

### Sub-issues

- [ ] Create a dedicated `ballooningDiagram` table if the feature should no longer live under `qualityDocument`
  - Move diagram-level fields such as `name`, `drawingNumber`, `revision`, `pdfUrl`, company ownership, audit fields, and any ballooning-specific metadata into a standalone model.
- [ ] Create a `ballooningFeature` table linked to `ballooningDiagram.id`
  - Include fields for `ballooningDiagramId`, `balloonNumber`, `page`, `x`, `y`, `rectX`, `rectY`, `rectWidth`, `rectHeight`, `description`, `nominalValue`, `tolerancePlus`, `toleranceMinus`, `unitOfMeasureCode`, `characteristicType`, and `sortOrder`.
- [ ] Add database constraints and indexes
  - Foreign key to the diagram record, cascade delete, and a unique constraint on `ballooningDiagramId + balloonNumber`.
- [ ] Backfill existing ballooning JSON into the new table
  - Migrate data from the current diagram storage into `ballooningDiagram` and `ballooningFeature`.
- [ ] Refactor ballooning services to read/write table data
  - Update `getBallooningDiagram`, `getBallooningDiagrams`, and `upsertBallooningDiagram` so the feature no longer depends on `qualityDocument` or nested JSON blobs.
- [ ] Update validators and shared types
  - Align `ballooningDiagramValidator`, `BalloonFeature`, and related payloads with the new persistence model.
- [ ] Update save flows in the editor
  - Save feature rows and coordinates through the new model without breaking existing diagram metadata like `name`, `drawingNumber`, `revision`, and `pdfUrl`.
- [ ] Add regression coverage
  - Verify create, edit, delete, reorder, and diagram delete behavior.

### Acceptance criteria

- [ ] One database row represents one balloon and its associated feature data.
- [ ] Balloon records are always associated with a diagram.
- [ ] Deleting a diagram removes related ballooning rows.

## 2. Frontend: zoom and PDF viewing

Goal: make the ballooning view usable for reviewing PDFs at different scales while keeping overlays aligned.

### Sub-issues

- [ ] Add explicit PDF zoom state to `BalloonDiagramEditor`
  - Support zoom in, zoom out, reset, and fit-to-width behavior.
- [ ] Add viewer controls to the toolbar
  - Show current zoom percentage and keep controls available whenever a PDF is loaded.
- [ ] Keep balloon overlays aligned while zooming
  - Ensure pins and highlight rectangles stay locked to the same PDF coordinates at every zoom level.
- [ ] Support multi-page PDF navigation cleanly
  - Confirm page rendering, scrolling, and page-specific annotations continue to work as zoom changes.
- [ ] Improve viewer loading and error states
  - Handle PDF upload, load failures, and empty-view states without breaking the editor.
- [ ] Verify interaction behavior with zoom enabled
  - Adding, selecting, and dragging balloons should still behave correctly after zooming.
- [ ] Add UI validation coverage or a manual QA checklist
  - Cover zoom controls, overlay alignment, and save/load behavior with PDFs.

### Acceptance criteria

- [ ] Users can open a PDF and change zoom without losing annotation alignment.
- [ ] Balloon placement and drag behavior remain accurate after zooming.
- [ ] Multi-page PDFs remain usable in the editor.
- [ ] The viewer still supports upload, replace, save, and reload flows.

## 3. Download PDF with ballooning features

Goal: let users export a PDF version of the drawing with balloon highlights and balloon numbers rendered onto it.

### Sub-issues

- [ ] Define the export format and rendering approach
  - Decide whether the export should flatten highlights and balloon pins directly onto the source PDF or generate a derived annotated PDF file.
- [ ] Add an export action to the ballooning view
  - Provide a clear `Download PDF` action in `BalloonDiagramEditor`.
- [ ] Render balloon annotations onto PDF pages
  - Draw highlight rectangles and balloon number markers using each feature's stored page and coordinate data.
- [ ] Support multi-page annotated exports
  - Ensure annotations are applied to the correct page for PDFs with more than one page.
- [ ] Preserve source document scaling and placement
  - Exported overlays should match what the user sees in the editor, independent of viewer zoom level.
- [ ] Define file naming and delivery behavior
  - Download should use a predictable filename based on diagram name, drawing number, or revision when available.
- [ ] Add export validation coverage
  - Verify the exported PDF contains the expected balloons, pages, and readable overlay styling.

### Acceptance criteria

- [ ] Users can download a PDF with balloon annotations applied.
- [ ] Exported balloon positions match the saved feature coordinates.
- [ ] Multi-page diagrams export correctly.
- [ ] Export works without altering the original uploaded PDF.

## 4. Extract text from PDFs with an LLM

Goal: add a later-phase workflow to extract drawing text and structured feature hints from uploaded PDFs using an LLM provider such as Amazon Bedrock or OpenAI.

### Sub-issues

- [ ] Define the extraction scope
  - Decide whether the system should extract raw OCR text only, structured dimensions/features, notes/requirements, or suggested balloon candidates.
- [ ] Choose the integration approach
  - Evaluate Amazon Bedrock and OpenAI for document understanding, cost, latency, privacy, and implementation complexity.
- [ ] Design the extraction pipeline
  - Define how PDFs are submitted, how page images or text are prepared, and whether extraction runs synchronously or as a background job.
- [ ] Define the output schema
  - Create a structured format for extracted notes, dimensions, GD&T callouts, and confidence scores so results can be reviewed before use.
- [ ] Build a review flow in the ballooning UI
  - Let users inspect extracted text or suggested features and accept, reject, or edit them before saving.
- [ ] Add provider abstraction and configuration
  - Keep the implementation provider-agnostic so Bedrock or OpenAI can be swapped without rewriting the UI flow.
- [ ] Add safeguards for cost and accuracy
  - Include retry/error handling, rate limiting, logging, and clear messaging that extracted data is assistive and requires user review.
- [ ] Add validation coverage
  - Test representative PDFs with dimensions, notes, and multi-page drawings to measure extraction quality.

### Acceptance criteria

- [ ] The system can send a drawing PDF to a configured LLM extraction pipeline.
- [ ] Extracted results are returned in a structured format suitable for review in the UI.
- [ ] Users can review and edit extracted content before it becomes ballooning data.
- [ ] The feature is isolated enough to support either Amazon Bedrock or OpenAI.
