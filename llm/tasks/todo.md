# Fix ERP CSV export to respect the current saved view

## Tasks

- [x] Update `Download.tsx`: extend props (columnAccessors, columnOrder, columnVisibility),
      call store hooks in body, derive ordered+visible export columns, build label-keyed
      rows with id→name substitution. Spawn subtasks to query the cache folder any time I
      need to learn something about the codebase. NEVER update the cache with plans or
      information about code that is not yet committed.
- [x] Update `TableHeader.tsx` line 335: pass the three props through to `<Download />`.
      Spawn subtasks to query the cache folder any time I need to learn something about the
      codebase. NEVER update the cache with plans or information about code that is not yet
      committed.
- [x] Typecheck. Spawn subtasks to query the cache folder any time I need to learn something
      about the codebase. NEVER update the cache with plans or information about code that is
      not yet committed.
- [ ] Commit and push. Spawn subtasks to query the cache folder any time I need to learn
      something about the codebase. NEVER update the cache with plans or information about
      code that is not yet committed.

## Review

- `Download.tsx`: added `columnAccessors` / `columnOrder` / `columnVisibility` props;
  call `useItems/useSuppliers/usePeople/useCustomers` in the body to build id→name
  Maps (memoized); derive the ordered, visible export columns (column id == accessor
  key; synthetic columns dropped since they're absent from `columnAccessors`); the
  click handler builds label-keyed rows so json2csv emits the view's labels in order,
  substituting names for `itemId`/`supplierId`/`employeeId`/`customerId` with raw-value
  fallback.
- `TableHeader.tsx`: passed the three already-available props to `<Download />`. No
  change to `Table.tsx` or any interface.
- Types confirmed by inspection (`ListItem` has `id: string; name: string`; `~/stores`
  import is an established pattern; `json-2-csv@5.5.10` supports `emptyFieldValue`).
  The full `tsgo` typecheck could NOT be run here — this environment has no installed
  `node_modules`.
- Browser verification (custom view in Inventory) still needs to be run against a
  running dev server, which isn't available in this container.
