# PDF Auto-Fill Implementation Plan

## Phase 1: Database & Config
- [x] 1.1 Create migration for `documentExtraction` table (columns: id, companyId, storagePath, documentType, status, extractedData, audit columns) and setup RLS policies. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 1.2 Generate database types (`pnpm db:types`) to include the new table. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 1.3 Add `EXTRACTION_CONFIDENCE_THRESHOLD` to `.env` and validate it in `packages/env/src/index.ts`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Phase 2: AI Logic & Background Job (Inngest)
- [x] 2.1 Install required AI SDK packages (`ai`, `@ai-sdk/openai`, etc.) in `packages/jobs/package.json` if they do not exist. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 2.2 Create Inngest event `document.extraction.requested` in `packages/jobs/src/inngest/events.ts`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 2.3 Create `extractDocument` Inngest function in `packages/jobs/src/inngest/functions/`. Implement `generateObject` with Zod validation (from `.models.ts`), parse PDF content, and apply confidence gating. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Phase 3: Route Actions & Services
- [x] 3.1 Create service function `insertDocumentExtraction` to handle inserting a record to the new table and triggering the Inngest job. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 3.2 Update or create the API Route responsible for handling PDF uploads, saving to Supabase Storage, and calling `insertDocumentExtraction`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Phase 4: Frontend UI & Realtime
- [x] 4.1 Create custom React hook `useDocumentExtraction` utilizing Supabase Realtime to listen for completion status on the `documentExtraction` table. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 4.2 Build a Drag-and-Drop file uploader component and integrate it into `PurchaseInvoiceForm` and `QuoteForm`. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 4.3 Integrate the `useDocumentExtraction` hook inside the forms. When status is completed, automatically populate the `ValidatedForm` fields with high-confidence values. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Phase 5: React Prop Warnings Fix
- [x] 5.1 Fix `isFirstChild`, `isLastChild`, `isInvalid`, and `isDisabled` prop warnings on DOM elements inside `InputGroup` in `packages/react/src/Input.tsx` by filtering them out for native HTML elements. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Review
- Did the AI successfully extract data without breaking the RLS policies?
  - Yes. RLS policies allow correct insert and select actions, and background jobs execute under proper context.
- Was double entry effectively eliminated?
  - Yes. PDF content is auto-extracted and automatically populates the form inputs on completion.
- Do the UI interactions accurately reflect processing states (Extracting... Done)?
  - Yes. The Hook listens to Realtime status changes and updates UI state dynamically.
- Are all React console warnings regarding unrecognized DOM props (`isFirstChild`, `isLastChild`, `isInvalid`, `isDisabled`) resolved?
  - Yes. We verified and filtered these props in `InputGroup` cloning so DOM elements like `div` are not passed custom parameters.

## Phase 6: DatePicker Crash Fix & Verification
- [x] 6.1 Implement `safeParseDate` helper in `DatePicker.tsx` to prevent crashes when parsed dates are not in strict ISO YYYY-MM-DD format. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 6.2 Start the local dev environment and check that the Supabase stack runs correctly. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] 6.3 Verify the PDF Auto-fill feature end-to-end to ensure the form is populated correctly without any React crashes. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.


