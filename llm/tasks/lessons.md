# Lessons

Patterns learned from corrections. Review at the start of each session.

## RLS Policies

- **NEVER** use the old `has_role('employee', "companyId") AND has_company_permission(...)` RLS pattern. It is deprecated.
- **ALWAYS** use the new pattern with `get_companies_with_employee_permission()` helper function and standardized policy names ("SELECT", "INSERT", "UPDATE", "DELETE").
- Reference migration: `20250201181148_rls-refactor.sql`
- Correct pattern:
  ```sql
  CREATE POLICY "SELECT" ON "public"."tableName"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('module_view'))::text[]
    )
  );
  ```
## Event-system interceptors (Carbon-specific)

- Carbon uses `attach_event_trigger(table_name, BEFORE[], AFTER[])` defined in `20260116215036_event_system_impl.sql` / `20260410030406_event-system-after-interceptors.sql`, not plain Postgres triggers. Each call **DROPs and re-CREATEs** the event trigger — so when adding interceptors to a table that already has some registered, the new call must include every existing interceptor plus the new ones, otherwise the old ones silently detach. Grep `attach_event_trigger('<table>'` across migrations to find the latest registration and merge arrays.
- Interceptor functions take `(p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB) RETURNS VOID`. Short-circuit early on operations that don't apply (`IF p_operation <> 'UPDATE' THEN RETURN; END IF;`). `RAISE EXCEPTION` to block; `RETURN` silently to skip.

## Identifiers over free text

- When a field names another record ("the operation that triggers shelf life"), store it as a foreign-key ID (`processId`) rather than a string description. Typo-proof, rename-safe, and the DB enforces existence. The first cut of shelf-life matched against `jobOperation.description` — the user flagged it as a caveat; switching to `processId` removed the fragility without changing the UX (a combobox lets the user create/pick a process by name).

## "Presence of a row = feature enabled"

- When a feature is opt-in per item (or per company, per whatever), don't encode the opt-in state as a `mode = 'NotManaged'` value on the parent table. Use a side table keyed by the parent's id; absence of a row = not enabled. Cleaner queries (no `WHERE mode <> 'NotManaged'` plumbing), narrower parent table, CHECKs on the side table can be tighter (no need to permit NULL fields for the "not enabled" case).
- Applied to `itemShelfLife` — started on `item` with a 3-value enum and two conditional fields; refactored to a side table with a 2-value enum where absence means the third case.

## Upsert helpers must not clobber on partial submits

- A single server action can receive form data from multiple different forms (different UIs posting to the same `$id.details.tsx`). If the upsert helper treats `undefined` as "clear the row", any form that doesn't include the field silently deletes data. Rule:
  - `undefined` -> no-op (form didn't opine, leave it alone)
  - explicit sentinel like `'NotManaged'` -> clear (user explicitly opted out)
  - real value -> upsert
- The Zod validator's `.default("SomeValue")` can defeat this: a missing form field gets the default, which is then passed as an explicit value to the helper. Mark the field `.optional()` instead and gate defaults on the form's `initialValues`.

## `.merge()` breaks after `.refine()`

- Zod's `.refine()` returns a `ZodEffects`, which is no longer a `ZodObject` — so downstream `.merge(...)` calls fail with a type error. When a base object needs to be shared across several validators AND have refines, keep the raw `z.object()` exported for merging and apply the refines in a helper applied to each merged child validator. See `applyStorageAndShelfLifeRefines` in `items.models.ts`.

## Supabase upsert with `onConflict` clobbers audit fields

- `.upsert({ createdBy, updatedBy, ... }, { onConflict: "itemId" })` sets both `createdBy` and `updatedBy` via `ON CONFLICT DO UPDATE SET ... = EXCLUDED....`, which overwrites `createdBy` on every update. When audit semantics matter, do an explicit `SELECT ... maybeSingle()` + branch on existence: `INSERT` sets `createdBy`, `UPDATE` sets `updatedBy`/`updatedAt`. `upsertItemShelfLife` follows this pattern.

## ERP app has no vitest infrastructure

- `apps/erp` has no vitest config and no tests. Adding unit tests for validators there requires setting up vitest + mocking the supabase client — not a 5-minute job. If a task says "add validator tests", the estimate should include test-infrastructure setup unless `packages/*` (which does have vitest) is the right home for the pure function.

## Use `accountId` not `accountNumber`

- The codebase has migrated from `accountNumber` to `accountId` for GL account references. The old `accountNumber`-based foreign keys in the DB schema (e.g., on `purchaseOrderLine`, `purchaseInvoiceLine`) are from older migrations — current code uses `accountId`. Always use `accountId` when referencing GL accounts.

## Do not commit without being asked

- Never create git commits unless the user explicitly asks to commit. Stage and commit only on request. The user wants to review changes before committing.

## Bash fallbacks when tools are missing

- `pandoc` is not on the user's machine. For `.docx` extraction, use the `anthropic-skills:docx` skill's `unpack.py` (needs `defusedxml`; install via `mise x python@3.14.2 -- pip install defusedxml`) or an equivalent Python/JS extraction, rather than assuming pandoc is available.

## React Prop Warnings in Child Cloning

- When using `React.cloneElement` to pass context/layout props (like `isFirstChild`, `isLastChild`, `isInvalid`, `isDisabled`) to children, **ALWAYS** check if the child is a standard DOM element (`typeof child.type === "string"`).
- Native DOM elements do not recognize these custom props and React will throw a console warning (`React does not recognize the ... prop on a DOM element`).
- Only pass custom/internal props to React components (non-string types), or explicitly filter them out before rendering elements to the DOM.

## Docker Loopback Connectivity and Vite Host Binding

- When using local containers (like Inngest) in non-portless mode, they connect back to the host application using `host.docker.internal`.
- For the connection to succeed on Linux, host applications (Vite/React Router dev servers) must listen on all interfaces (`0.0.0.0`) instead of only loopback (`127.0.0.1`), as Docker traffic arrives via the virtual bridge gateway IP rather than local loopback.
- Additionally, Vite's `server.allowedHosts` config must contain `"host.docker.internal"`; otherwise, Vite dev server blocks the Docker requests and returns a `403 Forbidden` response.

## DeepSeek/Ollama Multimodal File Limitation

- OpenAI-compatible third-party APIs (like DeepSeek or Ollama) do not support the `{ type: "file" }` message structure in `/chat/completions` requests. Sending a binary PDF file inside the `messages` array throws a deserialization API error.
- To make PDF auto-fill/data extraction compatible with DeepSeek and similar APIs, parse the PDF binary to raw text on the server first (using `pdfjs-dist/legacy/build/pdf.mjs` in Node.js) and send the extracted text within a standard `{ type: "text" }` message.

## DeepSeek / OpenAI-compatible API Compatibility Limits

- **Structured Output Limit (`json_schema`):** Some providers (like DeepSeek) do not support the newer OpenAI structured JSON schema output (`response_format: { type: "json_schema" }`). When calling `generateObject`, it internally uses this format and triggers a `"This response_format type is unavailable now"` error. In such cases, use `generateText` with standard prompts describing the schema, clean any markdown blocks, and parse the JSON manually using `JSON.parse` and validate with Zod (`schema.parse(...)`).
## Entity Resolution in Auto-Fill

- In PDF auto-fill/data extraction features, the AI extracts raw text values (such as `supplierName: "Dinamika Gerak Pres"` or `paymentTerms: "Net 30"`).
- However, form validation and submission require relational database IDs (UUIDs).
- **ALWAYS** implement dynamic database lookups (e.g., using `ilike` name matching on `supplier`, `customer`, or `paymentTerm` tables) on the frontend form side when the extraction completes.
- Once the entity ID is resolved, update the related states and fetch secondary dependent information (like supplier contact, location, and billing settings) to fully populate the form, matching the behavior of a manual selection.

## Committing Best Practices

- **Do not commit local environment configuration files:** Files that contain local development configurations (like `docker-compose.yml`, `docker-compose.dev.yml`, `packages/dev/src/env.ts`, `packages/dev/src/services/apps.ts`, and `packages/dev/src/worktree.ts`) must remain local and unstaged. Avoid committing them unless the user explicitly requests it.



## Exchange Rate Calculations

- **Direction of exchange rate conversions**: Always verify whether the exchange rate represents `1 base currency = X transaction currency` or `1 transaction currency = X base currency`. In Carbon, exchange rates represent how many transaction currency units make up 1 base currency unit (e.g. 1 USD = 15,000 IDR).
  - To convert from transaction currency (supplier currency) to base currency (company currency), **divide** by the exchange rate: `supplierUnitPrice / exchangeRate`.
  - To convert from base currency to transaction currency, **multiply** by the exchange rate: `unitPrice * exchangeRate`.
  - Stored generated columns in the database (like `"unitPrice"` on `"purchaseInvoiceLine"` and `"purchaseOrderLine"`) use division (`"supplierUnitPrice" / exchangeRate`). Therefore, frontend shipping/tax calculations and any custom fallback code must align with this logic to avoid displaying identical base/transaction values or incorrect multipliers.
- **Trigger Propagation**: Ensure Postgres triggers propagating `exchangeRate` from documents (`purchaseInvoice`) to lines (`purchaseInvoiceLine`) use the correct line-item column names (e.g., `invoiceId` instead of `purchaseInvoiceId`). Always write migrations to backfill historical line-item values when correcting trigger issues.
