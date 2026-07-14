# Change Order — git-style conflict resolution (release merge)

Date: 2026-07-13
Decisions: **2-way** diff (Yours vs Latest), **full-screen modal**, resolve **one part at a time**.

## Problem

At Implementation, when a same-part parallel CO released first, the live method moved under
this CO's `Version` draft. Today `ChangeOrderReleaseMerge.tsx` surfaces each conflicting line
as a badge + `"3 field change(s)"` string + Mine/Latest buttons — no picture of *what* changed.

Key finding: the diff is already field-level. `diffMethod` compares every column except pure
audit/linkage (`IGNORED_FIELDS`). `buildReleaseConflictEntries` (`changeOrder.diff.ts:609`)
already computes `before`/`after`/`changedFields`/children per line — then **discards** them,
emitting only `label`+`detail`. The write path (`reconcileDraftWithLive`/`applyTheirs`) reads
only `draftId`/`liveId`/`choice`. So enriching the loader payload is additive and safe.

## What counts as a conflict (confirmed with user)

Per BOM/BOP line: **Added** (only in draft), **Removed** (only in latest), **Modified**
(≥1 field differs — material quantity/UoM/sortOrder/feeding-op; operation
order/description/workCenter/procedure/costs/leadTime/workInstruction; operation children
steps/parameters/tools). Detection is unchanged — we fix the *view*.

## 1. Data layer (additive, non-breaking)

**`changeOrder.models.ts`** — extend `ChangeOrderReleaseConflictEntry`:
- `mine: Record<string, unknown> | null`   // draft row (diff `after`)
- `theirs: Record<string, unknown> | null` // live row (diff `before`)
- `changedFields?: Record<string, { before: unknown; after: unknown }>`
- `childChanges?: { steps: number; parameters: number; tools: number }` // operations

`ChangeOrderMergeResolution` unchanged. `defaultChoice`/`label`/`detail`/ids kept.

**`changeOrder.diff.ts`** — in `buildReleaseConflictEntries`, populate the new fields from the
already-computed `m`/`o` entries (`.after`, `.before`, `.changedFields`, per-bucket child
counts from `o.children`). No new queries.

## 2. UI layer

**New `ChangeOrderConflictResolver.tsx`** (full-screen modal, one part):
- `Modal`/`ModalContent` with className override → `max-w-[95vw] h-[92vh]`, internal scroll.
- Header: part id + name; subtitle "Another change order released a newer version — choose
  which version to keep for each change."
- Sticky sub-bar: column labels **Your version** | **Latest released**, bulk
  "Take all mine"/"Take all latest", live "N of M kept from yours" counter.
- Body grouped **Materials** / **Operations**. Each conflicting line = paired two-column block:
  - Each side renders the line's fields via a curated per-kind field spec (item id resolved
    via `useItems`; `workInstruction` shown as "Instructions changed", not raw JSON).
  - Changed fields highlighted (subtle amber bg, value shown per side). Absent side = dashed
    muted "Not in this version" ghost; added→green accent, removed→red accent (nods to git).
  - Selection: click a side / its radio → primary ring + check; other side dims to ~55%.
  - Operations show a child-change chip ("2 steps, 1 tool changed") — merge is op-unit granular.
- Footer: **Done** (confirm this part's picks → mark resolved, close). Cancel reverts.
- Local state seeded from `defaultChoice`; lifts picks via `onResolve(affectedItemId, choices)`.

**Rewrite `ChangeOrderReleaseMerge.tsx`** → release queue card:
- No conflicts → intro + Release button (unchanged behavior).
- Conflicts → warning alert + one row per affected part: id/name, "N conflicting changes",
  status pill (**Review required** amber / **Resolved** green), **Resolve** button → opens the
  resolver modal for that part.
- Holds master `choices` map + `resolvedParts` set. "Resolve & Release" disabled until every
  conflicting part is resolved. Submits `resolutions` + `mergeAcknowledged` exactly as today
  (same `fetcher.Form` → `path.to.changeOrderStatus`).

No route/loader change ($id.tsx already loads `releaseConflicts`; the payload just gets richer).

## 3. Verify

- `pnpm --filter erp typecheck` (filter is `erp`, not `@carbon/erp`).
- `pnpm --filter erp lint` on touched files.
- Browser (/auth → /test): drive a CO to Implementation with a parallel-released conflict;
  confirm the split view shows field-level old/new, picks work, and Release is gated until all
  parts are resolved. (Note: `applyTheirs` write path is still browser-unverified per AGENTS.md.)

## Out of scope

3-way/base column, provenance ("which CO"), per-child (step/param/tool) merge granularity —
all already deferred in AGENTS.md; op-unit granularity retained.
