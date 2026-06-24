# Inactive Options: Grey-out & Sink-to-Bottom (instead of filter-out)

## Summary

Today, "inactive" entities are **removed** from selection dropdowns. The current
branch does this for customers (`Customer.tsx` / `Customers.tsx` filter out any
customer whose status is "Inactive"). We want to replace filter-out with a
**grey-out + sink-to-bottom** treatment: inactive options stay visible, render in
a red tint, are non-selectable, sink below the active options, and show a tooltip
explaining why. This is added **once** as a capability in the shared select
primitives (mirroring how the inline "Create …" option was added once and
inherited by every wrapper), then wired into the three entity selects that have a
real active/inactive lifecycle: **Customers, Suppliers, Employees**.

## Why grey-out beats filter-out (not just preference)

The non-`inline` selects resolve the trigger/badge label by looking the selected
value up in `options` (`Combobox.tsx:69,145`; the multi-select badge at
`CreateableMultiSelect.tsx:414`). **If the selected value is filtered out of
`options`, that lookup fails and the trigger/badge renders blank.** Customers dodge
this only because they use an `inline` avatar preview sourced from the store. The
moment the filter pattern spreads to a non-inline select, filtering silently
breaks the display of records that already reference an inactive entity. Grey-out
keeps the option present, so the label always resolves — and a record pointing at
an inactive entity visibly flags itself (red tint) instead of looking normal.

## How our primitives work today (grounding)

- The searchable primitives — `Combobox`, `MultiSelect`, `CreatableCombobox`,
  `CreatableMultiSelect` (all in `packages/react/src/`) — each have their own
  `VirtualizedCommand`. Options are `{ label, value, helper?, helperRight? }`.
  **None support a per-option `disabled` flag.** Only `ChoiceSelect` does.
- The Creatable variants synthesize a `{ label: "New", value: "create" }` row and
  **append it last** (`CreateableMultiSelect.tsx:273-279`). Each wrapper just
  passes `onCreateOption`. This is the "one capability, every wrapper inherits it"
  precedent we are copying.
- Lists are virtualized with a uniform `estimateSize: () => itemHeight`
  (`Combobox.tsx:227`), so any inactive treatment must keep row height constant.
- `Badge` variants include `red` (soft tint) and `destructive` (solid);
  `Status` (`packages/react/src/Status.tsx`) supports `color="red"` **and a
  `tooltip` prop** — our tooltip mechanism, no new primitive needed.

## Design

### 1. Add `disabled` to the shared primitives (the single lever)

Add `disabled?: boolean` to the option type of `Combobox`, `MultiSelect`,
`CreatableCombobox`, `CreatableMultiSelect`. In each `VirtualizedCommand`:

- **Sink-to-bottom:** after search filtering and **before** appending the
  synthetic "Create" row, stable-partition into `[...enabled, ...disabled]`. The
  resulting render order is `[active…, inactive…, Create]`. Stable partition
  preserves the store's existing alphabetical order within each group.
- **Render:** disabled rows get a red tint and a `LuCircleSlash` indicator wrapped
  in a `Tooltip` ("This <entity> is inactive"). Use red Badge tokens
  (`text-red-700 dark:text-red-400`) so it matches the design system. Same row,
  same height — no second line.
- **Non-selectable:** set the cmdk `CommandItem` `disabled` prop (so arrow-keys
  skip it and Enter won't fire), and guard `onSelect`:
  - single-select: `if (item.disabled) return;`
  - multi-select: `if (item.disabled && !isSelected) return;` (block **adding**,
    still allow **removing** an already-selected inactive value).
- **Selected-value tint:**
  - Combobox trigger: red-tint the label when `selectedOption?.disabled`.
  - MultiSelect badge (`SelectedOption`): pass `disabled` through and render
    `Badge variant="red"` when set.

Backward-compatible: no `disabled` flag → behaves exactly as today. The 40+
existing wrappers are untouched.

### 2. Wire the three entity selects

| Wrapper | Primitive | Data ready? | Change |
|---|---|---|---|
| `Customer.tsx` | CreatableCombobox | ✅ (this branch) | Replace `.filter(inactive)` with `.map(o => ({…o, disabled: c.customerStatusId === inactiveStatusId}))` — keep all customers |
| `Customers.tsx` | CreatableMultiSelect | ✅ | Same |
| `Supplier.tsx` | CreatableCombobox | ✅ (`supplierStatus` in store) | Keep `allowedSuppliers`/`onlyApproved` hard filters; add `disabled: s.supplierStatus === "Inactive"` |
| `Suppliers.tsx` | CreatableMultiSelect | ✅ | Add `disabled: s.supplierStatus === "Inactive"` |
| `Employee.tsx` | Combobox | ⚠️ needs data-layer | See below |

**Employees data-layer prerequisite:** the `people` store carries only
`ListItem + avatarUrl`. The DB `employees` view has `active`/`status` but they
aren't fetched. So:
1. Add `active?: boolean | null` to `apps/erp/app/stores/people.ts`.
2. `RealtimeDataProvider.tsx`: add `active` to the initial `employees` select
   (line ~146) and to the realtime refetch select (line ~399).
3. `Employee.tsx`: `disabled: person.active === false` (explicit `false` only —
   `null`/pending/`Invited` stay enabled so we don't grey valid future assignees).
   The `"Unassigned"` assignee option stays enabled.

## Edge cases

1. **Selected value is itself inactive** (editing an old order). Rule: a currently
   *selected* option is always rendered enabled (deselectable) and never sunk —
   disabled blocks *adding*, not *removing*. The selected pill/trigger is
   red-tinted so the stale reference is visible.
2. **Create-row ordering** — partition before appending the synthetic "Create"
   row, else it gets buried above greyed rows.
3. **Virtualizer height** — inactive treatment stays on one line (tooltip +
   inline icon), preserving the uniform `itemHeight`.
4. **Keyboard nav** — cmdk `disabled` makes arrow-keys skip greyed rows; they
   remain surfaceable via search (greyed).
5. **Table filter dropdowns are out of scope** — `SalesOrdersTable`/`QuotesTable`
   filters intentionally show inactive customers (filtering existing records).
   They use a different faceted-filter, not these Form wrappers. Selection/
   creation inputs only.
6. **Stable order** — within each group preserve the store's alphabetical order.
7. **`inline` avatar wrappers** (Customer/Supplier/Employee) read labels from the
   store, so display already survives; grey-out only changes the dropdown list +
   adds the selected-value tint.
8. **All-inactive list** — greying shows them all (better than an empty
   "No option found").

## Tooltip risk & fallback

`TruncatedTooltipText` (a Tooltip) already renders inside these virtualized
popovers, so a per-row Tooltip is low-risk. If a nested Radix Tooltip-in-Popover
misbehaves during verification, fall back to a static right-aligned muted
"Inactive" label (still one line, no tooltip).

## Scope decisions (confirmed with user)

- Wire: **Customers + Suppliers + Employees**.
- Inactive options are **non-selectable** (not soft-selectable).
- Dropdown row: **plain greyed** (`opacity-50`) + sunk to bottom + muted
  `LuCircleSlash` + hover tooltip. **No red in the select.**
- **Red tint lives on the display chips, not the select.** Inactive
  customer/supplier/employee names render red (`text-red-600 dark:text-red-400`)
  in `CustomerAvatar` / `SupplierAvatar` / `EmployeeAvatar` (the latter also
  covers the assignee chip, which renders via `EmployeeAvatar`).
- Customer inactivity needs the status FK→"Inactive"-id resolved; done **once**
  app-wide in `RealtimeDataProvider` into the `$inactiveCustomerStatusId`
  nanostore (avoids a per-`CustomerAvatar` fetcher). Supplier/Employee read
  `supplierStatus`/`active` straight from their stores.

## Files touched

- `packages/react/src/Combobox.tsx`, `MultiSelect.tsx`, `CreateableCombobox.tsx`,
  `CreateableMultiSelect.tsx` — add `disabled` capability.
- `apps/erp/app/components/Form/Customer.tsx`, `Customers.tsx`, `Supplier.tsx`,
  `Suppliers.tsx`, `Employee.tsx` — wire it.
- `apps/erp/app/stores/people.ts`, `apps/erp/app/components/RealtimeDataProvider.tsx`
  — employee `active` plumbing.

## Next step

Hand off to `/plan` for the step-by-step implementation.
