# Plan: Standard Costing System

- **Status:** Draft — design decisions need veto before Phase 1 execution
- **Branch / worktree:** `standard-costing` → `/Users/barbinbrad/Code/carbon-standard-costing`
- **Research:** [`.ai/research/inventory-valuation-variances.md`](../research/inventory-valuation-variances.md)
- **Date:** 2026-07-08

---

## 1. Motivation

Carbon today offers `costingMethod = 'Standard'` on items but does **not** implement
standard costing. `calculateCOGS` is the *only* place that honors the method
(Standard → `itemCost.standardCost`); every GL posting path values inventory at
**actual** cost regardless of method. The result is an inconsistency:

- **Inventory is debited at actual** (receipt → PO cost; job completion → accumulated
  WIP cost) but a Standard item's **COGS is relieved at `standardCost`**. Nothing
  reconciles the difference to a variance account, so the inventory GL account and the
  true on-hand value **silently drift**. Standard-costed items with `standardCost = 0`
  (the DEFAULT for new items — see §9 risk) relieve COGS at **$0**.
- The "variances" that do post (`purchaseVarianceAccount` 5210 on invoice≠receipt,
  `materialVarianceAccount` 5220 for WIP residual) are **method-agnostic
  reconciliation/residual accounts**, not standard-cost variances. Switching an item
  to Standard produces **no** PPV-vs-standard, labor, or overhead variance.

Goal: make `costingMethod = 'Standard'` a real, coherent standard-costing system —
inventory held at standard, all deviations isolated into the existing variance
accounts, with a standard-cost roll-up from BOM + routing + overhead. Follows the
SAP price-control-"S" / NetSuite-Standard / Epicor cost-roll pattern documented in
the research file.

---

## 2. Current-state map (verified, file:line)

**Schema**
- `itemCostingMethod` enum `'Standard' | 'Average' | 'LIFO' | 'FIFO'` — `packages/database/supabase/migrations/20230330024716_parts.sql:209`
- `itemCost` (PK-less, keyed by `itemId`+`companyId`): `costingMethod`, `standardCost NUMERIC(15,5) DEFAULT 0`, `unitCost`, `costIsAdjusted BOOL`, `itemPostingGroupId` — same migration `:348`. `standardCost` + `costIsAdjusted` are **commented out** in the form/validator — `apps/erp/app/modules/items/items.models.ts:512-514`; only `unitCost` is user-editable (`ItemCostingForm.tsx`).
- `costLedger` with `costLedgerType` enum `'Direct Cost' | 'Revaluation' | 'Rounding' | 'Indirect Cost' | 'Variance' | 'Total'`, `remainingQuantity` (FIFO/LIFO layers), `quantity`, `cost`, `costPostedToGL` — `20230705033432_ledgers.sql:157,186`; layers added `20260504000000_cost-layers.sql`.
- `accountDefault` (**one row per company**, PK `companyId`) already has the full variance/absorption scaffold — `20230820020844_posting-groups.sql`; seeded in `packages/database/supabase/functions/lib/seed.data.ts:708`:
  - `inventoryAccount` 1210, `workInProgressAccount` 1230, `inventoryReceivedNotInvoicedAccount` 2125
  - `costOfGoodsSoldAccount` 5010, `purchaseAccount`, `directCostAppliedAccount`, `overheadCostAppliedAccount`, `laborAbsorptionAccount` 5060, `overheadAccount` 5050
  - `purchaseVarianceAccount` 5210, `materialVarianceAccount` 5220, `capacityVarianceAccount` 5240, `inventoryAdjustmentVarianceAccount` 5310
  - Cascades to `postingGroupInventory/Purchasing/Sales` via triggers.

**Posting paths** (cost source → GL)
- `post-receipt/index.ts` — PO receipt: `receiptLine.unitPrice` + weighted shipping → **DR inventory/WIP/indirect, CR GR/IR**. No `costLedger`, no `itemCost` write, does **not** read `costingMethod`. Inbound transfer uses `itemCost.unitCost`.
- `post-purchase-invoice/index.ts` — clears GR/IR at receipt (PO) cost, invoice−PO delta → **PPV (5210)**, CR payables at invoice cost; writes `costLedger 'Direct Cost'`. Reads `costingMethod` in the SELECT only, **never branches**.
- `post-sales-invoice/index.ts` / `post-shipment/index.ts` — COGS via `calculateCOGS` → **DR COGS, CR inventory**. Shipment posts COGS; SO-sourced invoice skips it.
- `post-production-event/index.ts` — `durationHours × workCenter.{labor,machine}Rate` → **DR WIP, CR laborAbsorption (5060)**. Reversible. Only labor/machine; **no overhead absorption**.
- `complete-job-to-inventory.sql` (DB function) — receives FG into inventory at **accumulated WIP actual cost** → **DR inventory, CR WIP**; writes `costLedger 'Output'` layer; updates `itemCost.unitCost` for **Average/FIFO/LIFO only** (not Standard); sets `trackedEntity 'Available'`. WIP fully clears here.
- `close-job/index.ts` — remaining WIP residual → **DR materialVariance (5220), CR WIP** (scrap/rounding/incomplete only, since FG receipt already cleared WIP).
- `shared/calculate-cogs.ts` — switch on `costingMethod`: Standard→`standardCost`, Average→`unitCost`, FIFO/LIFO→consume `costLedger` layers, fallback `unitCost`.

**Moving-average maintenance** (not on every receipt) — `update-purchased-prices/index.ts` (`unitCost = Σcost/Σqty` over last year, called from `api+/receipt.ts` when `updateLeadTimesOnReceipt`), `complete-job-to-inventory.sql`, and revision conversion `issue/index.ts:2747`.

**Missing entirely:** any BOM/routing **standard-cost roll-up**; `standardCost` is never computed and its UI is disabled.

---

## 3. Target accounting model

For an item with `costingMethod = 'Standard'`, inventory is **always** carried at
`standardCost`; every deviation is isolated into a variance account:

| Event | DR | CR | Variance |
|-------|----|----|----------|
| **Purchase receipt** | Inventory @ **standard** | GR/IR @ PO price | PO−std → PPV (5210) |
| **Purchase invoice** | GR/IR @ PO price | AP @ invoice price | invoice−PO → PPV (5210) |
| **Material issued to job** | WIP @ **standard material** | Inventory @ standard | usage: (actual qty−std qty)×std → material var (5220) |
| **Labor/machine reported** | WIP @ **standard labor** absorbed | Labor applied (5060) | actual labor−applied → capacity var (5240) |
| **Overhead** | WIP @ **standard OH** applied | OH applied (5050/`overheadCostApplied`) | applied−actual → capacity var (5240) |
| **FG received from job** | Inventory @ **standard** | WIP @ standard | WIP residual (actual−std) → decomposed variances |
| **Sale (COGS)** | COGS @ **standard** | Inventory @ standard | — (already correct) |
| **Standard cost change** | Inventory ± (newStd−oldStd)×qtyOnHand | Revaluation | → inv. adj. variance (5310), `costLedger 'Revaluation'` |

The item's `standardCost` is the frozen valuation; the **roll-up** derives it from
BOM material standards + routing standard times × work-center rates + a standard
overhead rate, and stores the material/labor/overhead **components** so the FG
variance can be decomposed.

---

## 4. Design decisions (recommendations — please veto/confirm)

> Per house convention I'm recommending defaults rather than blocking with questions;
> confirm or override before Phase 1 executes.

1. **Per-item, not company-wide.** Keep `costingMethod` on `itemCost` as the switch
   (Standard and Average/FIFO items coexist), matching SAP price-control-per-material
   and the existing enum. No new company toggle. **Recommend: yes.**
2. **Variance decomposition granularity — map to existing accounts, don't build the
   full six-way split.** Material usage → `materialVarianceAccount` (5220); labor +
   overhead (rate + efficiency combined) → `capacityVarianceAccount` (5240); purchase
   price → `purchaseVarianceAccount` (5210); revaluation → `inventoryAdjustmentVarianceAccount`
   (5310). **DECIDED (user 2026-07-08): reuse existing accounts 5210/5220/5240/5310;
   do NOT add a labor variance account.** (Aligns with "no matrix config" ethos.)
3. **Standard cost roll-up is a deliberate action, not automatic.** A "Roll up
   standard cost" action on the item (and a bulk costing run), like SAP's cost
   estimate / Epicor's cost roll — standards don't move silently. **Recommend: yes.**
4. **Store standard components on `itemCost`** (`standardMaterialCost`,
   `standardLaborCost`, `standardOverheadCost`, `standardCostRolledAt`) rather than a
   new table — keeps it one row per item, enables variance decomposition. **Recommend: yes.**
5. **Revalue on-hand inventory when `standardCost` changes** (don't leave old layers
   at stale standard). **Recommend: yes**, via a `costLedger 'Revaluation'` + GL entry.
6. **Overhead absorption into WIP at a standard rate.** Introduce standard overhead
   application in production (today only labor/machine absorb). **Recommend:** apply
   as % of standard labor or per standard labor hour, configurable per work center or
   a company default; credit `overheadCostAppliedAccount`.
7. **Default costing method for NEW items.** Today new items default to `'Standard'`
   with `standardCost = 0` (→ $0 COGS). **Recommend: change the insert default to
   `'Average'`** so Standard is opt-in and never silently zero. (See §9.)
8. **Cost splits across multiple output units are proportional to quantity, never
   even** (house rule) — relevant for allocating FG variance across a job's output qty.

---

## 5. Scope & sequencing (recommended)

Deliver as **four stacked PRs**; each is independently shippable and verifiable.
Phase 1 alone fixes the real drift bug for purchased items and is the recommended
first merge.

- **Phase 0 — Foundations** (enable standards, schema, default fix). Small.
- **Phase 1 — Purchased-item standard costing** (inventory@standard + PPV at receipt).
  Self-contained; fixes drift. **← ship first.**
- **Phase 2 — Standard cost roll-up engine** (BOM+routing+overhead → standardCost;
  revaluation on change). Enables meaningful standards for manufactured items.
- **Phase 3 — Manufactured-item standard costing** (FG@standard + decomposed
  production variances + standard overhead absorption). Depends on Phase 2.
- **Phase 4 — Reporting, docs, polish.**

Dependency: 0 → 1, 0 → 2 → 3, then 4. Phases 1 and 2 can proceed in parallel after 0.

---

## 6. Tasks

### Phase 0 — Foundations

- [x] **0.1 Enable `standardCost` in the item Costing UI.** _(done — 866e6cb22)_ Uncomment/re-enable in
  `apps/erp/app/modules/items/items.models.ts:512-514` and render the field in
  `ItemCostingForm.tsx` (guard: editable only when `costingMethod === 'Standard'`;
  show read-only rolled value + `standardCostRolledAt` for manufactured items).
- [x] **0.2 Migration — standard cost components.** _(done — 4f80bad05)_ `pnpm db:migrate:new add-standard-cost-components`.
  Add `standardMaterialCost`, `standardLaborCost`, `standardOverheadCost`
  (`NUMERIC` default 0), `standardCostRolledAt TIMESTAMP NULL` to `itemCost`.
  Idempotent (`ADD COLUMN IF NOT EXISTS`), randomized HHMMSS timestamp.
- [x] **0.3** ~~Add `laborVarianceAccount` (5230)~~ — **dropped**; §4.2 decision reuses
  existing accounts, so no new account/migration is needed.
- [ ] **0.4 Fix new-item default costing method** (decision §7): change insert default
  in `apps/erp/app/modules/items/.../update.tsx:~430` from `'Standard'` to `'Average'`.
  Add a data-quality check/migration note for existing `Standard` items with
  `standardCost = 0` (report, do not auto-mutate).
- [x] **0.5** _(done)_ Scoped typecheck `pnpm exec turbo run typecheck --filter=erp`
  (filter is `erp`, not `@carbon/erp`) — no new errors; 4 pre-existing baseline
  errors unrelated to this change, confirmed by stashing the edits and re-running.
  `generate:types` intentionally **deferred**: local regen produces a large spurious
  diff (types.ts is cloud-generated) and no code consumes the new columns yet —
  they'll be typed when the cloud regenerates or read via cast in Phase 2.
- **Verify:** _(done — browser-verified 2026-07-09)_ New part **STDTEST1** defaults to
  **FIFO**; the `Standard Cost` field is hidden for FIFO and appears (with helper text)
  when the method is set to **Standard**. Types compile (no new errors). Screenshot:
  `.ai/scratch/e2e/phase0-standard-cost-field.png`.

### Phase 1 — Purchased-item standard costing (inventory @ standard + PPV at receipt)

- [ ] **1.1 `post-receipt/index.ts` (PO receipt branch).** Load `itemCost.costingMethod`
  + `standardCost` for each line. When `Standard`: debit inventory at
  `standardCost × qty` (not `unitPrice`); credit GR/IR at PO cost (unchanged); post
  `(POcost − standard)` to `purchaseVarianceAccount` (5210) with
  `documentLineReference` to the receipt line. Non-Standard: unchanged. Write a
  `costLedger` layer at standard for Standard items so COGS layers stay consistent.
- [ ] **1.2 `post-purchase-invoice/index.ts`.** Confirm GR/IR clears at PO cost and the
  invoice−PO delta lands in PPV **without touching inventory** for Standard items
  (inventory already at standard from receipt). Ensure the existing PPV branch is not
  double-counting the receipt-time PPV. No inventory revaluation for Standard.
- [ ] **1.3 Inbound-transfer branch** (`post-receipt` transfer path): value Standard
  items at `standardCost` rather than `unitCost` for internal consistency.
- [ ] **1.4** Accounting tie-out test: receive a Standard item where PO cost ≠ standard,
  then invoice at a third price; assert inventory carries `standardCost × qty`, and
  PPV = (PO−std) + (invoice−PO) = (invoice−std). Use the rolled-back-psql-txn
  validation pattern for the SQL side.
- **Verify:** browser e2e (`/auth` + `/test`) — receive + invoice a Standard purchased
  item, screenshot the GL journal; inventory value = qty × standard.

### Phase 2 — Standard cost roll-up engine

- [ ] **2.1 Roll-up service.** New function (edge function `roll-standard-cost` or
  service in `items.service.ts`) that, for a manufactured item, walks its active make
  method: Σ(component `standardCost` × `quantityPer`) → material; Σ(routing
  op standard setup+run hours × work-center labor/machine rate) → labor; standard
  overhead (decision §6) → overhead. Writes `standardMaterialCost/LaborCost/OverheadCost`,
  `standardCost = sum`, `standardCostRolledAt`. Bottom-up: roll sub-assemblies first.
- [ ] **2.2 UI action** "Roll up standard cost" on the item Costing card + a bulk
  costing-run route (multi-select or by item group). Show component breakdown.
- [ ] **2.3 Revaluation on change.** When `standardCost` changes, post
  `(newStd − oldStd) × qtyOnHand` → `costLedger 'Revaluation'` + GL to
  `inventoryAdjustmentVarianceAccount` (5310); update on-hand layer costs.
- [ ] **2.4** Tests: roll-up of a 2-level BOM produces expected material/labor/overhead
  split; revaluation posts the correct delta and leaves inventory at new standard.
- **Verify:** roll up a manufactured item with a known BOM; assert
  `standardCost = material + labor + overhead`; screenshot the breakdown.

### Phase 3 — Manufactured-item standard costing + production variances

- [ ] **3.1 `complete-job-to-inventory.sql`.** For Standard FG items: receive into
  inventory at `standardCost × qty` (not accumulated WIP). Compute the WIP residual
  = accumulated actual − standard value, and **decompose** using the stored standard
  components: material usage → 5220, labor → 5240 (or 5230), overhead → 5240. Split
  across output units **proportional to quantity**. Do **not** update
  `itemCost.unitCost` for Standard (already skipped). Fork the function per the
  migration-function-redefinition rule (DROP IF EXISTS, preserve attributes).
- [ ] **3.2 Standard overhead absorption** in `post-production-event/index.ts`: in
  addition to labor/machine absorption, apply standard overhead into WIP crediting
  `overheadCostAppliedAccount`; actual overhead (if tracked) hits the variance.
- [ ] **3.3 Material usage variance at issue** (`issue/index.ts` backflush): for
  Standard items, charge WIP at standard material cost; (actual qty − standard qty) ×
  standard price → materialVariance. Keep it simple: if only aggregate is wanted, let
  the FG-receipt residual (3.1) capture usage and skip per-issue split.
- [ ] **3.4** `close-job` residual now ~0 for Standard jobs (variances settled at FG
  receipt); verify it only catches true leftovers.
- [ ] **3.5** Full accounting tie-out: a job whose actual material/labor/overhead each
  differ from standard settles FG @ standard and lands each variance in the right
  account, summing to (actual − standard). Rolled-back-txn SQL validation.
- **Verify:** browser e2e — build a Standard manufactured item on the shop floor with
  deliberate labor/material overruns; screenshot the three variance postings.

### Phase 4 — Reporting, docs, polish

- [ ] **4.1** Variance report / GL drill by variance account (PPV, material, capacity,
  revaluation) filtered by item/job/period — clone the nearest existing report screen.
- [ ] **4.2** Item Costing card: show current standard vs last actual and a
  variance-to-date indicator.
- [ ] **4.3** Curated docs + glossary (`docs` / `@carbon/glossary`): standard costing,
  PPV vs IPV, roll-up, revaluation. Per "keep docs in sync".
- [ ] **4.4** Surface design changes + screenshots in the PR (gh CLI).

---

## 7. Migrations (summary)

1. `add-standard-cost-components` — `itemCost` component columns (Phase 0).
2. (optional) `add-labor-variance-account` — `accountDefault` + seed (Phase 0/§4.2).
3. `redefine-complete-job-to-inventory` — Standard-aware FG receipt + variance split (Phase 3).

All idempotent, randomized HHMMSS, views redefined with `SELECT *` after column adds,
`generate:types` after each. Never rebuild the DB to test — hand to the user.

## 8. Testing & validation

- **Unit / tie-out** (`pnpm run test`): variance math (PPV, usage, labor, overhead,
  revaluation) sums to actual−standard; proportional-to-quantity allocation.
- **SQL migrations**: rolled-back `psql` transaction with asserts (supabase_admin +
  BEGIN/\i/ROLLBACK); clone prior `complete-job-to-inventory` via `pg_get_functiondef`
  for EXCEPT-equivalence on non-Standard paths (no regression for Average/FIFO/LIFO).
- **Typecheck** scoped per package; **never** whole-repo `tsc`.
- **Browser e2e** (`/auth` + `/test`) mandatory for each user-facing phase; enable
  accounting locally first (`/x/settings/accounting`, `accountingEnabled = true`).
- **Regression guard:** Average/FIFO/LIFO postings must be byte-for-byte unchanged.

## 9. Risks

- **Production-critical GL + multi-tenancy.** Every posting change is company-scoped
  and must tie out; a sign error mis-states inventory. Mitigate with tie-out tests +
  rolled-back SQL validation before any merge.
- **Default costing method = `'Standard'` today** (`update.tsx:~430`) with
  `standardCost = 0` ⇒ existing/new Standard items may relieve COGS at $0. Verify how
  many items are affected in real data; fix the default (§7 decision) and report—don't
  silently mutate—existing rows. **This is a latent correctness bug independent of this
  feature; flag to the user regardless of scope.**
- **`complete-job-to-inventory` is a large DB function**; redefine by forking latest
  (DROP IF EXISTS, preserve all attributes) — do not hand-edit in place.
- **Backward-compat of COGS layers**: Standard items must still produce sane
  `costLedger` layers or FIFO/LIFO-shared code paths could divide by zero on fallback.
- **Roll-up cycles**: BOM roll-up must detect cyclic make methods.

## 10. Open questions (resolve in grooming, before Phase 3)

- [x] ~~Variance decomposition granularity (§4.2)~~ — RESOLVED: reuse existing accounts
  (5210/5220/5240/5310), no new labor variance account.
- [ ] Standard overhead basis (§6): % of labor, per labor hour, or per machine hour;
  per-work-center vs company default?
- [ ] Do we want a **material usage variance at issue time** (3.3) or only the
  aggregate FG-receipt residual (3.1)? (Simpler = aggregate.)
- [ ] Period-end variance treatment: expense to COGS immediately (recommended MVP) vs
  reallocate across inventory/WIP/FG/COGS (SAP-style, heavier) — likely a later phase.
- [ ] Confirm changing the new-item default costing method won't break onboarding/CSV
  import defaults.

---

## Next step

Confirm/adjust §4 decisions and §5 scope, then execute **Phase 0 → Phase 1** via
`/execute`, committing per-task through the `/check-and-commit` gate. Phase 1 lands as
the first PR (fixes purchased-item drift); Phases 2–4 stack behind it.

---

## Addendum (2026-07-10): Inbound Freight Breakout — DECIDED: Option A (capitalize + break out)

Research: [`.ai/research/inbound-freight-landed-cost.md`](../research/inbound-freight-landed-cost.md).
User steer: freight visibility is wanted for **all** costing methods (catch a purchaser
next-day-airing everything). SAP (freight condition types + FR1 freight clearing) and
NetSuite (landed-cost category → holding account) both **capitalize freight into
inventory but break it out** through a dedicated freight account. **Decision (user,
2026-07-10): Option A — capitalize + break out** (not expense-to-P&L).

Today `post-receipt/index.ts:916` folds `lineWeightedShippingCost` into the single
inventory debit → freight is invisible. There is **no** inbound-freight account in
`accountDefault` (only outbound `6040 "Freight & Shipping Out"`).

### Target postings (freight = allocated `lineWeightedShippingCost`; goods = `lineCost`)

The freight **credit** always accrues to a new **Inbound Freight** clearing account
(uniform across methods → this is the reportable freight figure, tagged with the
supplier dimension). The freight **debit** side differs by method:

- **FIFO / Average / LIFO** (freight capitalized into inventory value):
  `DR Inventory (goods + freight)` · `CR GR/IR (goods)` · `CR Inbound Freight (freight)`
- **Standard** (inventory held at standard; freight can't capitalize):
  `DR Inventory (standard value)` · `DR PPV (goods PO − standard)` ·
  `DR PPV (freight — not capitalizable into standard)` ·
  `CR GR/IR (goods)` · `CR Inbound Freight (freight)`

At **purchase invoice**: clear `GR/IR (goods)` and `Inbound Freight (freight)` against
AP; invoice-vs-PO deltas → PPV (goods) and PPV/Inbound-Freight (freight). No inventory
revaluation for Standard (already at standard from receipt).

### Revised Phase 1 tasks (supersede/expand §6 Phase 1)

- [ ] **1.0 New account `purchaseFreightAccount`** ("Inbound Freight", balance-sheet
  clearing/liability, sibling of GR/IR 2125 → number **2126**). Migration: `ADD COLUMN
  IF NOT EXISTS` on `accountDefault`; seed 2126 for new companies (seed.data.ts +
  accountDefault mapping); **backfill existing companies** idempotently (`DO $$` loop:
  create the 2126 account per company if missing, set `purchaseFreightAccount`; guard
  companies lacking a chart). Cascade to posting groups if applicable. Types: read via
  cast if local `generate:types` is unavailable.
- [ ] **1.1 `post-receipt`** — load `itemCost.{costingMethod,standardCost}` per line;
  split freight out of the inventory debit to `purchaseFreightAccount` (all methods);
  for Standard, value inventory at `standardCost × qty`, goods PO−std → PPV, freight →
  PPV. Preserve FIFO/Avg/LIFO goods behavior byte-for-byte except the freight credit
  split. Write a `costLedger` layer at the capitalized value.
- [ ] **1.2 `post-purchase-invoice`** — clear GR/IR (goods) + Inbound Freight (freight);
  invoice-vs-PO deltas → PPV; no inventory revalue for Standard.
- [ ] **1.3 Tie-out test** — FIFO and Standard, receive (goods+freight) → invoice:
  assert freight lands in Inbound Freight, inventory = expected (landed for FIFO,
  standard for Standard), PPV = expected, GR/IR + Inbound Freight net to zero after
  invoice. Rolled-back psql-txn validation for the SQL/edge path.
- [ ] **1.4 Browser verify** — PO with `supplierShippingCost` → receipt → invoice;
  inspect the GL journal shows the separate Inbound Freight line; screenshot.

### Notes / risks
- Cross-cutting: changes FIFO/Average/LIFO postings too (freight credit now splits) —
  regression-guard the goods lines.
- `purchaseFreightAccount` backfill for existing companies is the delicate part (new
  account per company); follow the `20260228023426` `DO $$` per-company loop precedent.
- The migration must be applied (`crbn migrate`) before the edge functions reference the
  new account.
