# Inactive options: grey-out + sink-to-bottom (replace filter-out)

Design spec: docs/specs/inactive-options-greyout-design.md

## Primitive capability (one lever → all selects)
- [ ] New shared `InactiveOptionIndicator` (red `LuCircleSlash` + hover tooltip) in packages/react/src/
- [ ] `Combobox.tsx`: add `disabled?`/`disabledReason?` to option type; sink-to-bottom sort; red tint + indicator + onSelect guard; red-tint selected trigger label
- [ ] `MultiSelect.tsx`: same + red badge variant for selected-inactive
- [ ] `CreateableCombobox.tsx`: same; sort BEFORE appending the "Create" row
- [ ] `CreateableMultiSelect.tsx`: same + red `SelectedOption` badge; sort before "Create"

## Wire entity selects
- [ ] `Customer.tsx`: filter-out → `disabled` flag (keep all customers + exclude filter)
- [ ] `Customers.tsx`: filter-out → `disabled` flag
- [ ] `Supplier.tsx`: keep allowed/onlyApproved hard filters; add `disabled` for "Inactive"
- [ ] `Suppliers.tsx`: add `disabled` for "Inactive"
- [ ] Employees data layer: `people.ts` store `active`; RealtimeDataProvider initial + realtime selects add `active`
- [ ] `Employee.tsx`: `disabled: active === false` (Unassigned stays enabled)

## Verify
- [x] typecheck @carbon/react, @carbon/form, erp — all clean
- [x] biome check --write on all touched files — clean
- [ ] Update llm/cache after commit (NOT before); revert this todo before commit

## Review
- Capability added once in `@carbon/react` primitives (`disabled?`/`disabledReason?`
  option fields), inherited by the `@carbon/form` wrappers via `{...props}` and the
  `…BaseProps` type — same lever as the inline "Create" row. 40+ other selects
  unaffected (flag is optional, default behavior unchanged).
- Treatment: red tint (`!text-red-*`), trailing `LuCircleSlash` + hover tooltip
  (`InactiveOptionIndicator`), non-selectable via onSelect guard + `aria-disabled`
  (NOT cmdk `disabled`, which would kill the tooltip), sunk to bottom via stable
  sort placed before the synthetic "Create" row.
- Selected-but-inactive: stays removable (guard only blocks *adding*); selected
  pill/trigger shows red (`variant="red"` badge / red trigger label).
- Wired: Customer, Customers, Supplier, Suppliers (data already client-side),
  Employee (added `active` to people store + both RealtimeDataProvider selects).
- Open assumption: employee inactive = `active === false` (conservative; null/Invited
  stay enabled). Confirm against real data.

## Rules
Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
