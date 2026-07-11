# Accounting Sync Engine v2 — Phase D (QuickBooks Desktop via self-hosted QBWC) — implementation plan

**Spec:** .ai/specs/2026-07-09-accounting-sync-engine.md (Phase D — transport DECIDED 2026-07-09: build)
**Research:** .ai/research/quickbooks-accounting-sync-engine.md (§QBWC protocol contract, §qbXML coverage, §error semantics)
**Branch:** feat/quickbooks-enterprise (worktree /Users/barbinbrad/Code/carbon-feat-quickbooks-enterprise)

**Prerequisites:**
- Phase A+B plan complete (operations ledger, account mapping, posting pre-flights).
- Phase C **Task C1** (provider-keyed SyncFactory) — if Phase C hasn't started, execute C1
  first as part of this plan; it is shared infrastructure.
- If Phase C Task C8 landed, the shared posting pre-flight helpers live in
  `packages/ee/src/accounting/core/posting.ts`; if not, Task D10 performs that extraction.

**Naming (fixed):** integration id `quickbooks-desktop`; provider code at
`packages/ee/src/accounting/providers/quickbooks-desktop/`;
`externalIntegrationMapping.integration = 'quickbooks-desktop'`.

**Protocol references** (read before D3/D7/D8): the QBWC contract summarized in the research
file — eight SOAP operations, WSDL namespace `http://developer.intuit.com/`, session-ticket
auth, percent-done loop, `newMessageSetID`/`oldMessageSetID` error recovery, iterator pattern.
Primary source: Intuit QBWC Programmer's Guide (PDF, linked in the research Sources).

## Progress
- [x] Task D1: Add fast-xml-parser to @carbon/ee *(catalog entry 5.3.1 in pnpm-workspace.yaml + "catalog:" ref in packages/ee/package.json — repo pins shared deps via the pnpm catalog; import verified)*
- [x] Task D2: Migration — qbwcSession table *(20260709191928_qbwc-sessions.sql written per the spec sketch: SELECT-only RLS via get_companies_with_employee_role, service-role writes, health index on (companyId,status,lastSeenAt). NOT applied — no local DB, same deferral as the Phase A migration; qbwcSession code uses the cast workaround until generate:types runs)*
- [x] Task D3: qbXML core (envelopes, parsing, error map, iterators, recovery ids) *(qbxml/envelope.ts + parse.ts + errors.ts: template-literal request building (strict OSR element order), XMLParser with preserveOrder so interleaved *Rs types keep document order (the specified @_ attr options still apply; leaves stay strings), windows-1252 prolog → latin1 + cp1252 remap (curly-quote fixture), classifyStatus per the table, buildIteratedQuery/readIterator, plus parseMessageSetStatus for the 9002 recovery branch D8 needs. QbxmlValidationError reuses core/posting's JournalEntrySyncFailure envelope. 5 golden fixtures; every classifyStatus branch tested)*
- [x] Task D4: Entity request builders + response parsers *(qbxml/entities/{customer,vendor,item-non-inventory,invoice,bill,purchase-order,journal-entry}.ts + shared.ts (QBO-provider convention): buildAddRq/buildModRq (lists only)/buildQueryRq (FullName for lists; RefNumber or TxnDate-range memo-scan for txns)/parseRet. Name caps per hierarchy level (41 list / 31 item), address lines ≤41 → NAME_TOO_LONG; unmapped AccountRef → UNMAPPED_ACCOUNTS; fitRefNumber ≤11 else Memo-only; every txn stamps `Carbon <readableId> <entityId>` (JE stamps line memos — no header memo on JournalEntryAdd, first line always carries it); JE debit/credit split by Carbon sign, abs 2dp, cent-exact balance assert → UNBALANCED_JOURNAL. Golden request snapshots + parseRet fixtures + every length branch + escaping round-trip. ee tests 200 → 283, typecheck clean)*
- [x] Task D5: Credential issuance + .QWC generation service *(qbwc/credentials.ts + qwc-file.ts: CARBON_QBWC_OWNER_ID hardcoded (C1885F59-B650-49EE-93B7-CDDC31482121 — never change), generate/rotate (rotate preserves fileId), scrypt N=16384/r=8/p=1 `scrypt$salt$hash` + timingSafeEqual verify; buildQwcFile golden-snapshotted, https asserted (localhost exempt), AppSupport = AppURL origin + /support, OwnerID/FileID braced-uppercase. appUrl is a caller parameter — D11 should pass the request origin like integrations.xero.oauth.ts (`new URL(request.url).origin` + `/api/integrations/quickbooks-desktop/qbwc`; `getAppUrl()` from @carbon/env is the env-based alternative))*
- [x] Task D6: qbwcSession service *(qbwc/session.ts over the unapplied 20260709191928 migration via the operations.ts cast-helper pattern (TODO cast until generate:types). create/getOpen (ticket-only lookup, 30-min expiry, bumps lastSeenAt)/setBatch (increments requestsSent, stores qbxmlMajorVersion when passed)/clearBatch/close (does NOT clear the batch — that's the recovery marker)/findInterruptedBatch/getLastPollAt. Interrupted-batch rule: non-empty claimedOperationIds AND (Closed|Error immediately, Open only past the 30-min expiry), newest lastSeenAt first — pure helpers isSessionExpired/isInterruptedBatchCandidate/selectInterruptedBatch unit-tested per the operations.test.ts pattern. NOTE for D8: claimed ops go stale-reclaimable at 10 min (operations.ts) before a crashed Open session expires at 30 — always run findInterruptedBatch before claiming. ee tests 283 → 313)*
- [x] Task D7: QBWC protocol handler — authenticate + session lifecycle *(qbwc/soap.ts + handler.ts: fast-xml-parser SOAP parse (removeNSPrefix, parseTagValue off — versions and the embedded qbXML stay strings) → {operation, params}; responses render string-arrays as `<string>` children, ints bare; unknown op → soap:Client Fault, handler throw → soap:Server Fault (handleQbwcRequest never throws). serverVersion = @carbon/ee package.json version; authenticate parses carbon-<companyId> → getAccountingIntegration + active + webConnector verifyPassword → nvu on any auth failure, "busy" on infra errors, "none" ONLY when zero Pending AND no interrupted batch (recovery forces a session), else [ticket, ""]; session createdBy = integration.updatedBy ?? 'system'. getLastError must read Closed/Error rows, so session.ts gained getSession (any-status lookup, no lastSeenAt bump — narrow flagged addition); closeConnection closes only Open sessions (an Error session keeps status+message for health). DEVIATION from the ctx sketch: { client, database (Kysely for SyncContext — syncers can't be built without it; D9 passes the jobs-drain pool), now(), getSyncer? (test seam defaulting to SyncFactory.getSyncer) }. handler/soap deliberately NOT barrel-exported (matches the D11 barrel note — D9 imports by path). Golden SOAP tests both directions (qbwc/__tests__/soap.test.ts) + full SOAP conversation tests over an in-memory PostgREST fake (fake-client.ts + handler-auth.test.ts))*
- [x] Task D8: QBWC protocol handler — work loop + crash recovery *(sendRequestXML: expired ticket → ""; first call stores qbxmlMajorVersion; RECOVERY FIRST — findInterruptedBatch → adopt the batch onto THIS session (setSessionBatch) THEN clear the dead session's marker (crash between = newest session wins the next scan), answer with the empty oldMessageSetID probe, claim nothing. No session 'recovery-probe' marker exists (qbwcSession has no metadata column) and none is needed: receiveResponseXML branches on the response itself — message-set statusCode 9002 ⇒ writes never landed ⇒ ops stay pinned to claimedOperationIds and the next sendRequestXML rebuilds them from persisted phases under a fresh newMessageSetID; anything else (including a stored recovery response) is processed per-request like a live batch. Work gathering: session follow-ups (claimedOperationIds filtered to In Flight) + claimPendingOperations top-up to 20 total, bounded re-claim rounds when every candidate resolves at build time; buildRequest outcomes → completeOperation / failOperation(failure envelope, jobs-drain metadata-merge parity) / persist metadata.qbdPhase (only when changed) BEFORE sending. receiveResponseXML: non-empty hresult → closeSession(Error, message) + return -1; ops stay In Flight WITH the batch marker so the next conversation probes before any re-send — deliberate deviation from the plan's "return to Pending" (the D6 probe IS the double-post guard; no release helper added). classifyStatus ok/not-found → syncer.processResponse (completed → completeOperation(externalId); needs-followup → persist nextPhase, op rides the session; failed → envelope; plain throw → Failed flattened); warning → Warning(errorCode); QB_BUSY → Failed retryable via inbox Retry; 3200 first hit → set editSequenceRetry + STRIP qbdPhase (a stored phase would beat the flag in resolveQbdListPhase) and keep In Flight, second 3200 → Failed. Survivors re-pin via setSessionBatch with the SAME messageSetId (a probe replay of an answered set is idempotent; requestsSent overcounts by design), else clearSessionBatch. Percent-done: remaining (followUps + Pending count) === 0 → 100 else min(99, floor(resolved/(resolved+remaining)*100)) — the 25-op drain yields 80 → 100. core/operations.ts gained the sanctioned narrow additions getSyncOperationsByIds + updateOperationMetadata (+ colocated stub-client tests). Scripted-conversation tests (handler-loop.test.ts) cover the two-batch drain, mixed 3100/3176/ok, hresult→getLastError, BOTH recovery branches with exact probe/request XML + build-call counting (no duplicate Add), query→mod→completed progression, and 3200 retry-once. ee tests 364 → 397; ee + jobs typecheck clean)*
- [x] Task D9: SOAP resource route + rate limiting *(api+/integrations.quickbooks-desktop.qbwc.ts → URL /api/integrations/quickbooks-desktop/qbwc — verified identical to the D11 QWC generator's QBWC_ENDPOINT_PATH constant (dotted api+ filenames split on dots per the integrations.jira.issue.create.ts → /api/integrations/jira/issue/create precedent in path.ts). action-only: content-type must contain text/xml (else 415 plain text) → raw request.text() → KV Ratelimit slidingWindow(30, "1 m") keyed `qbwc:<first x-forwarded-for hop ?? "unknown">[:<strUserName via cheap regex>]` (construction copied from api+/docs.ts, the only api+ Ratelimit precedent; limit exceeded → soap:Client Fault, 429) → handleQbwcRequest with { client: getCarbonServiceRole(), database: getDatabaseClient() (~/services/database.server — Kysely<KyselyDatabase>, same type the jobs drain uses), now }. Catch-all returns buildQbwcSoapFault("Server", …) with 500 — QBWC never sees an HTML error page; loader (GET) → 405 plain-text hint (webhook.xero has no loader precedent, plan's fallback used). `export const config = { runtime: "nodejs" }` (scrypt verify). No path.to entry — webhook.xero precedent, the QWC generator hardcodes its constant. FLAGGED DEVIATION: the D7 "route imports handler by file path" note is unimplementable from apps — @carbon/ee's exports map forbids deep imports — so a dedicated subpath export "./accounting/qbwc" → new src/accounting/qbwc-endpoint.ts re-exports ONLY handleQbwcRequest (+ QbwcHandlerContext type) and buildQbwcSoapFault; handler/soap/session internals stay out of the ./accounting barrel per the D11 note. TS2589 cliff shifted again as predicted: restored the @ts-ignore at SalesInvoiceForm.tsx customerShipping embed (the exact directive D11 removed as unused — @ts-ignore not @ts-expect-error so it survives the cliff receding))*
- [x] Task D10: QbdProvider + entity syncers + polled-transport drain gate *(provider.ts: capabilities {transport:"polled"}, buildQbdSyncConfig forces the 7 supported entities push-to-accounting/owner-carbon (enabled flags survive; journalEntry stays opt-in) + disables salesOrder/inventoryAdjustment/payment/employee; validate() is credentials-only — DEVIATION from spec's "session within 7 days", poll staleness is D11's health surface. entities/shared.ts carries the two-phase polled contract D8 consumes: buildRequest(op) → {outcome:"request",requestXml,phase}|{"completed",reason,externalId?}|{"failed",failure} (QbxmlValidationError/JournalEntrySyncError → failed envelope; plain throws = handler fails op); processResponse(op,response) branches on rqType, ONLY for classifyStatus ok/not-found (handler owns warning/retryable/fatal), links mapping (ListID/TxnID + editSequence in mapping metadata) → completed|needs-followup{nextPhase}. Phase lives in op.metadata.qbdPhase (persist BEFORE send); lists: unmapped → query-by-FullName (hit → link+mod, miss → add), mapped+editSequence → mod direct, editSequenceRetry/missing-editSequence → re-query; transactions: mapped → idempotent completion, else Add straight (no query round trip — RefNumber/Memo stamp + newMessageSetID recovery are the dedupe). Dependency refs mapping-first with FullName fallback (no JIT push; unknown name → 3140 INVALID_REFERENCE Warning). Journal reuses core/posting pre-flights (account ListIDs via getAccountMappings 'quickbooks-desktop', control-account guard, manual settings.lockDate like QBO, redate note folded onto first line memo). Registry registered under ProviderID.QUICKBOOKS_DESKTOP; AccountingProvider union + getProviderIntegration case wired; ProviderCapabilities transport renamed webConnector → polled. drainSyncOperations returns {…zero, skippedReason:"polled-transport"} via pure getDrainTransportSkipReason (enqueue paths untouched); XeroProvider got an explicit optional capabilities declaration and the Xero entity syncers a xeroProvider getter (the union addition surfaced 30 untyped provider.request calls). ee tests 313 → 364, jobs 88 → 93, both typechecks clean. KNOWN erp ripple for D9/D11: apps/erp webhook.xero.ts fetchContactType/fetchInvoiceType params must narrow AccountingProvider → XeroProvider (2 annotations; erp typecheck fails until then — task chip filed))*
- [x] Task D11: Connection card UI (credentials, QWC download, checklist, health) *(integrations.$id route: `qbd-generate-credentials` intent before the plan gate (read-modify-write metadata merge — settings/syncConfig never clobbered; rotate preserves fileId + qbxmlVersion; plaintext password returned once in action data, ApiKeys shown-once pattern, flash + stay on page) + loader `qbdConnection` {hasCredentials, username, lastPollAt via getLastPollAt, stale = never or >24h}. Download DEVIATION from the intent sketch: a GET resource route `integrations.$id.qwc.tsx` (/x/settings/integrations/:id/qwc, path.to.integrationQwcFile) — apps/erp has ZERO Content-Disposition action precedents (every download is a resource loader: download.$token, backup-archive, bom[.]csv) and RRv7 unwraps raw Responses from UI-route actions into action data, so an intent POST can't attach; appUrl = request origin + hardcoded `/api/integrations/quickbooks-desktop/qbwc` (webhook.xero precedent — no path.to for API endpoints). QbdConnectionCard.tsx (NOT barrel-exported, local structural types): stale amber banner + "Last poll" relative time, 4-step spec checklist (admin/single-user/unattended grant, QB inventory off, account-mapping ?tab= deep link, conversion date), generate/rotate with confirm modal + re-enter-password warning, shown-once password with copy, .qwc download anchor, QBWC install instructions. IntegrationForm Tabs made controlled + synced to ?tab= so the checklist deep link switches tabs while the drawer is open. qbwc/{credentials,qwc-file,session} now exported from the qbd provider barrel (handler/soap deliberately still unexported). TS2589 cliff shifted: added the documented suppression at purchasing.service getPurchasingRFQSuppliers, removed the now-unused directive in SalesInvoiceForm.tsx)*
- [x] Task D12: Integration registration + plan gating *(packages/ee/src/quickbooks-desktop/config.tsx — defineIntegration({ id: "quickbooks-desktop", category: "Accounting", active: true }) with NO oauth block: `oauth` is optional in IntegrationOptions and fns.ts only checks clientId when oauth exists; settings []/empty schema → installs via IntegrationCard's non-OAuth empty-POST fallback, and the drawer then shows Connection/Account Mapping/Posting/Sync Activity (category === "Accounting" holds). Logo reused by exporting the QBO config's Logo (onshape precedent, no SVG duplication). Registered in the integrations array + named export directly after QuickBooks. ProviderID.QUICKBOOKS_DESKTOP already existed (D10). Plan gating: NO-OP as established in Phase C — quickbooks-desktop is not in INTEGRATION_WHITELIST so the generic INTEGRATIONS feature gate applies in both the route action and IntegrationCard, exactly like Xero; FEATURE_PLANS has no per-integration keys, nothing to change)*
- [ ] Task D13: Gates + scripted protocol e2e + manual QB verification checklist *(PARTIAL 2026-07-11: scripted protocol e2e + full scoped gates green. qbwc/__tests__/handler-e2e.test.ts drives the FULL conversation through handleQbwcRequest over the fake client with the REAL entity syncers (getSyncer seam constructs QbdCustomer/QbdSalesInvoice/QbdJournalEntry syncers with only the DB members faked — fetchLocal/mappingService/persistLink + the journal cached loaders, the syncers.test.ts pattern — and a live in-memory mapping store so links persist across calls): seeded company + active integration (webConnector credentials, real scrypt hash) + mapped accounts + 3 Pending ops (customer, Submitted invoice, Posted balanced journal, FIFO createdAt); authenticate → [ticket,""] → sendRequestXML #1 exact-golden message set (CustomerQueryRq + InvoiceAddRq w/ FullName dependency fallback + JournalEntryAddRq, phases persisted pre-send) → receiveResponseXML #1 (query miss + 2 Add oks) = 66 → sendRequestXML #2 exact-golden CustomerAddRq under a fresh newMessageSetID → receiveResponseXML #2 = 100 → closeConnection "Sync complete"/session Closed; all 3 ops Completed with externalIds, mappings linked with TxnID/ListID + EditSequence metadata, build/process calls each exactly [customer, invoice, journalEntry, customer]; a SECOND identical conversation answers "none" at authenticate — zero new requests, zero new sessions (idempotency). Gates: typecheck 3/3 (@carbon/ee tsgo, @carbon/jobs tsc, erp tsgo — after the D9 TS2589 remedy), @carbon/ee 398 tests, @carbon/jobs 93 tests, biome clean on all 5 touched files. DEFERRED by the standing no-stack/no-browser/no-Windows constraint: browser /test pass (connection card generate/download/regenerate, checklist, stale-poll banner, sync-activity statuses), migration application (pnpm db:migrate) + generate:types, and the manual QB Desktop Enterprise 24 gate (QBWC .qwc install + one-time password, Application Certificate grant, two poll cycles with Carbon ids in Memo, NAME_EXISTS collision remediation, kill-QBWC-mid-batch recovery with no duplicate documents). Run those when a stack / Windows+QB environment is up — the scripted run is the CI-level evidence; the manual gate is a release gate, not a merge gate.)*

## Dependencies
- D1 → D3 → D4. D2 → D6. D5 independent after D1 (needs no XML lib for hashing; QWC XML uses D3's builder — so D5 after D3).
- D7 needs D5+D6. D8 needs D3+D4+D6+D7+D10 (buildRequest/processResponse). D9 needs D7+D8.
- D10 needs D4 (+C1). D11 needs D5. D12 needs D10+D11. D13 last.
- Parallel-safe groups: {D2, D1→D3→D4} then {D5, D6, D10} then {D7→D8→D9, D11}.

---

## Task D1: Add fast-xml-parser to @carbon/ee

**Depends on:** none
**Files:**
- Modify: `packages/ee/package.json`

**Steps:**
1. Check how sibling deps are declared: `grep -n '"zod"\|catalog:' packages/ee/package.json`.
   If the repo pins shared deps via the pnpm catalog (root `pnpm-workspace.yaml`), add
   `fast-xml-parser` to the catalog and reference `"catalog:"` from `@carbon/ee`; otherwise
   add a caret-pinned version directly: `pnpm --filter @carbon/ee add fast-xml-parser`.
2. This dependency was explicitly approved with the build decision (spec Open Questions,
   2026-07-09). Do not add any other new dependency in this phase — SOAP envelopes are
   hand-rolled templates, password hashing uses Node `crypto`.

**Verify:**
```bash
pnpm --filter @carbon/ee exec node -e "const {XMLParser,XMLBuilder}=require('fast-xml-parser');console.log('ok')"
# Expected: ok
```

**Out of scope:** `soap`, `xml2js`, or any other XML/SOAP package.

---

## Task D2: Migration — qbwcSession table

**Depends on:** none (parallel with D1)
**Files:**
- Create: `packages/database/supabase/migrations/<generated-timestamp>_qbwc-sessions.sql`

**Steps:**
1. `pnpm db:migrate:new qbwc-sessions` (randomized HHMMSS if `000000`; timestamp newer than
   everything on the branch including the Phase A migration).
2. SQL — exactly the spec's `qbwcSession` sketch (Data Model Changes section): columns
   `id` (`DEFAULT id('qbwc')`, doubles as the session ticket), `companyId`, `integration`,
   `status` CHECK `('Open','Closed','Error')`, `currentMessageSetId`,
   `claimedOperationIds TEXT[]`, `requestsSent`, `qbxmlMajorVersion`, `lastSeenAt`,
   `closedAt`, `errorMessage`, audit columns, composite PK, company FK CASCADE. Idempotent
   guards (`IF NOT EXISTS`). Indexes: `companyId`, `createdBy`, `updatedBy`, plus
   `("companyId", "status", "lastSeenAt")` for health queries. RLS: enable; `SELECT` policy
   via `get_companies_with_employee_role()`; NO user write policies (service-role writes
   only from the SOAP endpoint).
3. Apply: `pnpm db:migrate`. Then `pnpm run generate:types` — same cloud-types diff caveat
   and commit rule as Phase A+B Task 2 (isolate the new table's types or use casts; STOP if
   unsure).

**Verify:**
```bash
pnpm db:migrate
# Expected: applies <timestamp>_qbwc-sessions.sql cleanly.
grep -n "qbwcSession" packages/database/src/types.ts | head -3
# Expected: Row/Insert/Update types present.
```

**Out of scope:** Any change to `accountingSyncOperation` or `companyIntegration`.

---

## Task D3: qbXML core

**Depends on:** D1
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbxml/envelope.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbxml/parse.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbxml/errors.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbxml/__tests__/qbxml.test.ts`

**Steps:**
1. `envelope.ts`: `buildMessageSet({ version, newMessageSetID?, oldMessageSetID?, requests })`
   → `<?xml version="1.0" encoding="utf-8"?>\n<?qbxml version="{version}"?>\n<QBXML>
   <QBXMLMsgsRq onError="continueOnError" [newMessageSetID="..."] [oldMessageSetID="..."]>
   {requests}</QBXMLMsgsRq></QBXML>`. Each request element carries a `requestID` attribute
   (the caller supplies it — it will be the operation id; assert ≤ 50 chars). Version comes
   from the session handshake, never hardcoded (default "16.0" only for tests).
2. `parse.ts`: `parseMessageSetResponse(xml)` using `XMLParser` (options:
   `ignoreAttributes: false`, `attributeNamePrefix: "@_"`, arrays forced for `*Rs` children)
   → ordered array of `{ requestID, rqType, statusCode: number, statusSeverity:
   "Info"|"Warn"|"Error", statusMessage, payload }` where payload is the parsed `*Ret`
   subtree. Handle windows-1252 declarations by re-decoding the buffer as latin1 when the
   XML prolog declares it (unit-tested with a fixture containing a `’` curly quote).
3. `errors.ts`: `classifyStatus(code)` → `{ kind: 'ok'|'not-found'|'warning'|'retryable'|
   'fatal', errorCode }` per the spec's mapping table: 0 ok; 1 not-found (query miss, not an
   error); 3100 → warning `NAME_EXISTS`; 3120 → warning `OBJECT_NOT_FOUND`; 3140 → warning
   `INVALID_REFERENCE`; 3170/3171 → warning `PERIOD_LOCKED`; 3175/3176/3180 → retryable
   `QB_BUSY`; 3200 → retryable-once `STALE_EDIT_SEQUENCE`; 500-series Warn severities →
   warning `QB_WARNING`; everything else Error-severity → fatal `QB_ERROR_<code>`.
4. Iterator helper: `buildIteratedQuery(rqName, inner, { iterator: "Start"|"Continue",
   iteratorID?, maxReturned })` + `readIterator(rs)` → `{ iteratorID, remainingCount }`.
5. Tests: golden fixtures (checked in under `__tests__/fixtures/*.xml`) — a CustomerAddRs
   success, a 3100 failure, a multi-response set preserving order and requestID matching,
   iterator continuation, windows-1252 decoding.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: qbxml core tests pass (envelope shape, parse order, every classifyStatus branch).
```

**Out of scope:** SOAP envelopes (D7); entity-specific fields (D4).

---

## Task D4: Entity request builders + response parsers

**Depends on:** D3
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbxml/entities/customer.ts`
- Create: `.../qbxml/entities/vendor.ts`
- Create: `.../qbxml/entities/item-non-inventory.ts`
- Create: `.../qbxml/entities/invoice.ts`
- Create: `.../qbxml/entities/bill.ts`
- Create: `.../qbxml/entities/purchase-order.ts`
- Create: `.../qbxml/entities/journal-entry.ts`
- Create: `.../qbxml/entities/__tests__/entities.test.ts` (+ fixtures)

**Steps:**
1. Each module exports `buildAddRq`, `buildModRq` (where the entity is two-way), `buildQueryRq`
   (by FullName for lists / by RefNumber+Memo scan for transactions — used for
   query-before-insert dedupe), and `parseRet` (→ `{ listId | txnId, editSequence,
   fullName?, fields }`).
2. Field mapping constraints (enforce in builders, throw typed `QbxmlValidationError` the
   syncer converts to Warnings): customer/vendor `Name` ≤ 41 chars → `NAME_TOO_LONG`;
   item/account `Name` ≤ 31 chars/level; addresses ≤ 41/line; `RefNumber` ≤ 11 via
   `fitRefNumber(readableId)` (returns undefined when it doesn't fit — the readable id then
   goes ONLY in `Memo`); every transaction stamps `Memo` with `Carbon <entity readable id>
   <entity id>`. Account references always `<AccountRef><ListID>…` from the account mapping
   (FullName fallback only before first resolution).
3. `journal-entry.ts`: `JournalEntryAdd` with `JournalDebitLine`/`JournalCreditLine` split by
   the Carbon sign convention (positive amount = debit); amounts `abs(...)` formatted 2dp;
   assert debit total === credit total before returning; TxnDate = postingDate;
   `RefNumber` via `fitRefNumber(journalEntryId)`.
4. Tests: golden request-XML snapshots per builder (assert exact XML strings), parseRet
   fixtures with ListID/EditSequence extraction, every length-violation branch.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: entity builder/parser tests pass with golden snapshots.
```

**Out of scope:** SalesOrderAdd, ReceivePaymentAdd, InventoryAdjustmentAdd, CreditMemoAdd,
DataExt custom fields (all deferred — mirror the live Xero entity set + journals only);
assemblies/builds.

---

## Task D5: Credential issuance + .QWC generation service

**Depends on:** D3
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbwc/credentials.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbwc/qwc-file.ts`
- Create: `.../qbwc/__tests__/credentials.test.ts`

**Steps:**
1. `credentials.ts` (Node `crypto` only): `generateConnectionCredentials(companyId)` →
   `{ username: "carbon-" + companyId, password: randomBytes(24).toString("base64url"),
   ownerId: CARBON_QBWC_OWNER_ID, fileId: randomUUID().toUpperCase() }`;
   `hashPassword(password)` → `scrypt` (N=16384, r=8, p=1, 32-byte key, 16-byte random salt,
   stored as `scrypt$<saltB64>$<hashB64>`); `verifyPassword(password, stored)` →
   `timingSafeEqual`. `CARBON_QBWC_OWNER_ID` is a fixed uppercase GUID constant exported from
   this file (generate once, hardcode — it identifies the Carbon app to QuickBooks across all
   companies and must never change).
2. The `webConnector` credentials variant (Phase A models) stores `{ type: "webConnector",
   username, passwordHash, ownerId, fileId }` in `companyIntegration.metadata.credentials`.
   Regeneration rotates `passwordHash` only — `fileId` is preserved (QuickBooks stamped it
   into the company file on first connect; changing it breaks the pairing).
3. `qwc-file.ts`: `buildQwcFile({ appUrl, username, ownerId, fileId })` → the QWC XML
   (`<QBWCXML>` root): AppName "Carbon", AppID "" (empty element, required tag), AppURL,
   AppDescription, AppSupport = AppURL origin + "/support" (same domain — QBWC enforces
   this), UserName, OwnerID/FileID in braces uppercase (`{9AF4...}` format), QBType `QBFS`,
   `<Scheduler><RunEveryNMinutes>5</RunEveryNMinutes></Scheduler>`,
   `<IsReadOnly>false</IsReadOnly>`. `appUrl` MUST be https (assert; localhost exempt for
   dev). Find the canonical public base URL the same way the OAuth flows build their
   redirect URIs — grep how `integrations.xero.oauth.ts` resolves its absolute redirect URL
   and reuse that helper/env; if there is no single canonical helper, STOP and report which
   env var should be canonical rather than inventing one.
4. Tests: QWC XML golden snapshot; password hash/verify round-trip + wrong-password false +
   constant-time compare (equal-length buffers); regenerate preserves fileId.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: credentials + qwc-file tests pass.
```

**Out of scope:** UI (D11); certificate/TLS provisioning (deployment concern — production
already serves HTTPS).

---

## Task D6: qbwcSession service

**Depends on:** D2
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbwc/session.ts`
- Create: `.../qbwc/__tests__/session.test.ts`
- Copy from (precedent): `packages/ee/src/accounting/core/operations.ts` (service shape from Phase A Task 5)

**Steps:**
1. Service functions (`client` first, `{data, error}`, companyId-scoped): `createSession`,
   `getOpenSession(ticket)` (validates status `Open`, bumps `lastSeenAt`), `setSessionBatch
   (ticket, { messageSetId, operationIds, qbxmlMajorVersion })`, `clearSessionBatch`,
   `closeSession(ticket, status: 'Closed'|'Error', errorMessage?)`,
   `findInterruptedBatch(companyId)` → the most recent `Open` session with a non-empty
   `claimedOperationIds` (crash recovery input, D8), `getLastPollAt(companyId)` (health, D11).
2. Stale sessions: `getOpenSession` treats a session with `lastSeenAt < now() - 30 min` as
   expired → returns not-found (QBWC sessions are minutes-long; expired tickets force
   re-authentication).
3. Tests: lifecycle happy path, expired-ticket rejection, interrupted-batch lookup.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: session service tests pass.
```

**Out of scope:** SOAP parsing; operation claiming (D8 composes this with Phase A's
`claimPendingOperations`).

---

## Task D7: QBWC protocol handler — authenticate + session lifecycle

**Depends on:** D5, D6
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbwc/handler.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/qbwc/soap.ts`
- Create: `.../qbwc/__tests__/handler-auth.test.ts`

**Steps:**
1. `soap.ts`: parse an incoming SOAP envelope (fast-xml-parser) → `{ operation, params }`
   for the eight operations (`serverVersion`, `clientVersion`, `authenticate`,
   `sendRequestXML`, `receiveResponseXML`, `connectionError`, `getLastError`,
   `closeConnection`); build response envelopes
   (`<soap:Envelope ...><soap:Body><{op}Response xmlns="http://developer.intuit.com/">
   <{op}Result>...</{op}Result>...`). String-array results render as
   `<string>...</string>` children. Golden-snapshot both directions. Unknown operation →
   SOAP Fault.
2. `handler.ts`: `handleQbwcRequest(soapXml: string, ctx: { client, now(): Date })` →
   `Promise<{ soapXml: string }>` — pure with respect to transport (no Request/Response
   objects). This task implements: `serverVersion` (return `@carbon/ee` package version),
   `clientVersion` (return `""`), `authenticate` (below), `connectionError` (mark session
   `Error`, return `"DONE"` — never retry alternate file paths), `getLastError` (return the
   session's stored error text, or `"NoOp"` when the session is open with no error and no
   work — QBWC then pauses 5s and retries), `closeConnection` (close session, return
   `"Sync complete"`).
3. `authenticate(strUserName, strPassword)`: look up the `quickbooks-desktop`
   `companyIntegration` row whose `credentials.username` matches (username embeds the
   companyId — parse it, then verify against that single row; unknown/inactive →
   `["", "nvu"]`), `verifyPassword` (D5); on failure `["", "nvu"]`. On success: count
   `Pending` operations for the integration — zero → `["", "none"]` (no session row);
   otherwise `createSession` and return `[ticket, ""]` (empty second element = use the
   currently-open company file). Wrong-password attempts are also rate-limited at the route
   (D9).
4. Tests: full SOAP-in/SOAP-out conversations for: bad password → `nvu`; no work → `none`;
   work available → ticket + `""`; getLastError NoOp; closeConnection closes the session row.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: handler-auth conversation tests pass (assert on exact SOAP response bodies).
```

**Out of scope:** sendRequestXML/receiveResponseXML (D8); HTTP wiring (D9).

---

## Task D8: QBWC protocol handler — work loop + crash recovery

**Depends on:** D3, D4, D6, D7, D10 (buildRequest/processResponse)
**Files:**
- Modify: `packages/ee/src/accounting/providers/quickbooks-desktop/qbwc/handler.ts`
- Create: `.../qbwc/__tests__/handler-loop.test.ts`

**Steps:**
1. `sendRequestXML(ticket, strHCPResponse, strCompanyFileName, qbXMLCountry,
   qbXMLMajorVers, qbXMLMinorVers)`:
   a. Validate session. On the session's FIRST call, store `qbxmlMajorVersion` from the
      params.
   b. **Crash recovery first**: if `findInterruptedBatch` returns a batch (from a prior
      crashed session for this company), respond with an `oldMessageSetID` recovery message
      set for that batch's `currentMessageSetId` and move the batch onto this session. Do
      NOT claim new work yet.
   c. Otherwise claim up to 20 `Pending` operations (Phase A `claimPendingOperations`,
      integration `quickbooks-desktop`, FIFO by `createdAt`), call each operation's syncer
      `buildRequest` (D10) — pre-flight failures (`Warning`) drop out of the batch here —
      wrap survivors via `buildMessageSet` with `newMessageSetID = randomUUID()` and
      `requestID = operation.id` per request, persist the batch on the session
      (`setSessionBatch`), return the XML. Nothing pending → return `""`.
2. `receiveResponseXML(ticket, response, hresult, message)`:
   a. Non-empty `hresult` → QB-side COM failure: return claimed ops to `Pending` (attempt
      already counted), session `Error` with `message`, return `-1`.
   b. If the response answers an `oldMessageSetID` recovery query: statusCode 9002 ("no
      stored response") → the interrupted batch never reached QB → return its ops to
      `Pending` and clear the batch (they'll be re-sent next loop); a stored response →
      process it exactly like a normal batch response (writes DID land).
   c. Normal batch: `parseMessageSetResponse`, match responses to operations by `requestID`,
      apply `classifyStatus` → `completeOperation` (store ListID/TxnID + EditSequence via
      the syncer's `processResponse`) / `failOperation` (warning or retryable per the map;
      `STALE_EDIT_SEQUENCE` → enqueue ONE automatic retry with `trigger: 'retry'` and
      metadata flag `editSequenceRetry: true`; a second occurrence → `Failed`). Clear the
      session batch.
   d. Return percent-done: remaining `Pending` count zero → `100`, else
      `min(99, floor(processed/total*100))` (any value 0–99 makes QBWC call
      `sendRequestXML` again).
3. Tests (scripted conversations with a mocked client + D4 golden fixtures):
   - Two-batch drain: 25 seeded ops → first sendRequestXML has 20 requests, second has 5,
     percent-done 0–99 then 100, all ops `Completed` with externalIds.
   - Mixed response: one 3100 (Warning), one 3176 (Failed retryable), rest Completed.
   - hresult failure: ops back to Pending, session Error, `-1` returned, `getLastError`
     returns the message.
   - Crash recovery both branches: 9002 → re-send; stored-response → completes without
     re-sending (assert NO duplicate Add request is ever built — the double-post guard).
   - EditSequence: 3200 → one retry op enqueued; second 3200 → Failed.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: handler-loop conversation tests pass, including both recovery branches.
```

**Out of scope:** Iterated large QUERIES (reads) — v1 pulls nothing from QBD except
query-before-insert lookups inside buildRequest batches.

---

## Task D9: SOAP resource route + rate limiting

**Depends on:** D7, D8
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.quickbooks-desktop.qbwc.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/webhook.xero.ts` (raw-body resource route, no requirePermissions) and grep `Ratelimit` usage in `apps/erp/app/routes/api+/` for the KV limiter pattern

**Steps:**
1. Resource route, `action` only (QBWC always POSTs): read the raw body with
   `await request.text()`, verify `content-type` contains `text/xml`, rate-limit by client
   IP + parsed username (KV `Ratelimit`, 30 requests/min — QBWC's serial loop stays far
   below this; brute-force does not), call `handleQbwcRequest(soapXml, { client:
   getCarbonServiceRole(), now })` (use the exact service-role accessor the Xero webhook
   route uses), return `new Response(result.soapXml, { headers: { "Content-Type":
   "text/xml; charset=utf-8" } })`. Never throw HTML error pages at QBWC — catch and return
   a SOAP Fault with status 500.
2. GET requests return 405 with a short plain-text hint ("QuickBooks Web Connector
   endpoint").
3. Add the route to `apps/erp/app/utils/path.ts` if resource routes are registered there
   (grep `webhook.xero` in path.ts to see whether webhook-style routes get `path.to`
   entries; mirror whatever the precedent does).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0.
pnpm --filter @carbon/ee test
# Expected: still green (handler untouched).
```

**Out of scope:** requirePermissions (auth is the QBWC handshake); CORS (QBWC is not a
browser).

---

## Task D10: QbdProvider + entity syncers + polled-transport drain gate

**Depends on:** D4 (+ Phase C Task C1 registry; run C1 first if absent)
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/provider.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/entities/{customer,vendor,item,invoice,bill,purchase-order,journal-entry}.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/index.ts` — registry registration
- Modify: the Phase A drain helper (`packages/jobs/src/inngest/functions/integrations/sync-external-accounting.ts` + `events/sync.ts` drain step) — skip integrations whose provider `capabilities.transport === "polled"` (their ops wait for the QBWC poll)
- Create: `packages/ee/src/accounting/providers/quickbooks-desktop/__tests__/syncers.test.ts`
- Copy from (precedent): Phase B's `providers/xero/entities/journal-entry.ts` for pre-flight composition; `core/posting.ts` if C8 already extracted the shared helpers — if it did NOT, extract them here first (pure move; if Xero coupling blocks the move, STOP and report)

**Steps:**
1. `QbdProvider extends BaseProvider`: `capabilities = { transport: "polled",
   supportsWebhooks: false, supportsJournalPush: true }`; `validate()` = credentials present
   + a session seen within 7 days (best-effort — there is no synchronous ping to a polled
   desktop); `getSyncConfig` mirrors Xero's defaults with `journalEntry` available.
2. QBD syncers implement the standard `BaseEntitySyncer` abstract methods where meaningful
   (fetchLocal/mapToRemote reuse) plus the two polled-transport halves the QBWC handler
   drives: `buildRequest(op, ctx)` → uses D4 builders + shared pre-flights (account mapping,
   period lock vs `metadata.settings.postingSync.lockDate` [manual for QBD, like QBO],
   AR/AP-control guard, name-length checks, query-before-insert dedupe request when no
   mapping exists) and `processResponse(op, parsedRet, ctx)` → link
   `externalIntegrationMapping` (ListID/TxnID as `externalId`, EditSequence in metadata),
   then the standard complete path. Direct `pushToAccounting` returns a descriptive error
   ("polled transport — operations are drained by the Web Connector").
3. Register all syncers under `ProviderID.QUICKBOOKS_DESKTOP = "quickbooks-desktop"` in the
   C1 registry.
4. Drain gate: resolve the provider's capabilities where Phase A drains claimed ops; polled
   providers' ops stay `Pending` (the enqueue paths — events, backfill, posting — are
   unchanged).
5. Tests: buildRequest golden XML for each entity (happy + one pre-flight Warning each);
   processResponse links mapping + completes; journal build excludes doc-backed sourceTypes
   (reuse the Phase B exclusion constants); drain-gate unit test (polled op not drained,
   REST op drained).

**Verify:**
```bash
pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: all pass / exit 0.
```

**Out of scope:** Pull/two-way sync from QBD (v1 is push-only for every QBD entity —
document sync direction defaults locked to push in the provider's getSyncConfig);
ReceivePayment/SalesOrder/InventoryAdjustment syncers.

---

## Task D11: Connection card UI (credentials, QWC download, checklist, health)

**Depends on:** D5
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — actions `intent=qbd-generate-credentials`, `intent=qbd-download-qwc` (the download returns the .qwc file as `application/xml` attachment), loader adds `getLastPollAt`
- Create: `apps/erp/app/modules/settings/ui/Integrations/QbdConnectionCard.tsx`
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Integrations/` components from Phase A Task 7/11 (tab + card layout), `ApiKeys` (secret-shown-once pattern — grep how a new API key is displayed exactly once and mirror it)

**Steps:**
1. Generate action (`settings_update`): create credentials (D5), store the `webConnector`
   variant in `companyIntegration.metadata.credentials`, return the plaintext password in
   the action data for one-time display (never persisted; mirror the ApiKeys
   shown-once UX). Regenerate: same, but preserve `fileId` and warn that the customer must
   re-enter the password in QBWC.
2. Download action streams `buildQwcFile(...)` as `carbon-quickbooks.qwc`
   (`Content-Disposition: attachment`).
3. Card content: connection status (Last poll via `getLastPollAt` — relative time; >24h or
   never → warning banner), the 4-step setup checklist from the spec (admin grant/unattended
   mode, QB inventory features off, account mapping complete [link], conversion date), and
   the credential/QWC actions. Render only for integration id `quickbooks-desktop`.
4. The sync-activity tab and account-mapping/posting-settings sections (Phase A/B) must
   render for this integration too — they key off `category === "Accounting"`, verify that
   holds once D12 registers the integration.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: exit 0 / no new Biome errors.
```

**Out of scope:** Email alerts for stale polls; multi-file-per-company connections (one QB
company file per Carbon company in v1).

---

## Task D12: Integration registration + plan gating

**Depends on:** D10, D11
**Files:**
- Create: `packages/ee/src/quickbooks-desktop/config.tsx` — `defineIntegration({ id: "quickbooks-desktop", name: "QuickBooks Desktop", category: "Accounting", active: true, ... })` with NO `oauth` block (settings-based connection; check `packages/ee/src/fns.ts` `defineIntegration` for whether `oauth` is optional — if it is required, STOP and report rather than faking an OAuth config)
- Modify: `packages/ee/src/index.ts` — export + add to the integrations array
- Modify: `packages/ee/src/accounting/core/models.ts` — `ProviderID.QUICKBOOKS_DESKTOP = "quickbooks-desktop"` (if not added in D10)
- Modify: the `FEATURE_PLANS` gate (same file as Phase C Task C10) — gate `quickbooks-desktop` like Xero

**Steps:**
1. Reuse the QuickBooks logo component from `packages/ee/src/quickbooks/config.tsx` (import,
   don't duplicate the SVG). Description: posting + document sync to QuickBooks Desktop
   Enterprise via the QuickBooks Web Connector.
2. Verify the integration card renders and the detail page shows: connection card (D11),
   sync activity, account mapping, posting settings.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit 0.
```

**Out of scope:** Pricing/plan tier decisions beyond mirroring Xero's gate.

---

## Task D13: Gates + scripted protocol e2e + manual QB verification checklist

**Depends on:** all prior tasks
**Files:** none (verification only)

**Steps:**
1. Full scoped gates:
   `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp`,
   `pnpm --filter @carbon/ee test`, `pnpm --filter @carbon/jobs test`, `pnpm run lint`.
2. Scripted end-to-end protocol run (vitest, no QuickBooks): seed a company with the
   integration active, mapped accounts, 3 Pending ops (customer, invoice, posted journal);
   drive the FULL conversation through `handleQbwcRequest` (authenticate → loop →
   closeConnection) asserting: all ops Completed, mappings linked, golden qbXML matches, a
   second identical conversation produces zero new requests (idempotency).
3. Browser pass (`/test`): connection card generate/download/regenerate flows, checklist
   renders, stale-poll banner (seed `lastSeenAt` old via psql), sync-activity statuses.
4. **Manual QB gate — requires a Windows machine with QuickBooks Desktop Enterprise 24 +
   QBWC + a tunnel to the dev stack (or a staging deploy). This cannot run in CI.** Execute
   and record in the run log:
   - [ ] Install the downloaded .qwc in QBWC; enter the one-time password.
   - [ ] First poll: QB shows the Application Certificate dialog; grant "Yes, always; allow
         access even if QuickBooks is not running" as QB Admin in single-user mode.
   - [ ] Two poll cycles complete: customer, invoice, and journal appear in QuickBooks with
         Carbon ids in Memo; sync activity shows Completed with ListID/TxnIDs.
   - [ ] Name-collision case (pre-create the customer name in QB) → Warning `NAME_EXISTS`
         in the inbox with readable remediation text.
   - [ ] Kill QBWC mid-batch, restart → recovery query runs; no duplicate documents in QB.
   If no Windows/QB environment is available, STOP here and report exactly which items
   remain unverified — the scripted protocol run is the CI-level evidence; the manual gate
   is a release gate, not a merge gate.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp && pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test && pnpm run lint
# Expected: all exit 0; scripted protocol e2e green; manual-gate checklist recorded (or
# explicitly reported as environment-blocked).
```

**Out of scope:** Committing (explicit ask only); customer-facing setup docs on the docs
site (write with the PR per keep-sources-in-sync); Rightworks-hosted validation (post-GA).

## Acceptance-criteria coverage map (spec Phase D)

- Scripted QBWC conversation completes seeded ops → D7, D8, D13
- nvu / none / busy paths → D7 (+ D8 for 3176)
- Crash recovery, no double-post → D8 (both branches), D13 manual kill-test
- Error-mapping fixtures (3100/3140/3170/3200) → D3, D8, D10
- QWC file contents + password-once + FileID preservation → D5, D11
- Journal push balanced + doc-backed exclusion → D4, D10
- Manual Enterprise 24 gate → D13
