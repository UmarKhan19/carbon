# Menu Customization Design

Users can reorder and hide modules in the ERP sidebar. Preferences persist server-side, scoped to user/company, so they follow the user across sessions and devices.

## Data Model

New table `userModulePreference`:

```sql
CREATE TABLE "userModulePreference" (
  "id"        TEXT NOT NULL DEFAULT xid(),
  "userId"    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "module"    TEXT NOT NULL,
  "position"  DOUBLE PRECISION NOT NULL,
  "hidden"    BOOLEAN NOT NULL DEFAULT false,
  UNIQUE ("userId", "companyId", "module")
);
```

- One row per module per user/company.
- `module` stores the permission key (e.g. `"sales"`, `"accounting"`) or a stable identifier for role-based modules (e.g. `"shopFloor"`).
- `position` uses fractional ordering: inserting between 1.0 and 2.0 yields 1.5. Only the moved row is updated.
- No rows means the user sees the default hardcoded order.

### RLS

```sql
CREATE POLICY "SELECT" ON "userModulePreference"
  FOR SELECT USING ("userId" = auth.uid()::text);

CREATE POLICY "INSERT" ON "userModulePreference"
  FOR INSERT WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "UPDATE" ON "userModulePreference"
  FOR UPDATE USING ("userId" = auth.uid()::text);

CREATE POLICY "DELETE" ON "userModulePreference"
  FOR DELETE USING ("userId" = auth.uid()::text);
```

Users can only access their own rows.

## Frontend UX

### Entering Edit Mode

- A wrench/tool icon button in the sidebar header enters customization mode.
- A colored bar appears at the top of the sidebar: title "Menu customization", **Save** and **Cancel** buttons.

### In Edit Mode

- Items become draggable via `@dnd-kit/sortable`.
- Clicking an item selects it (blue border highlight) instead of navigating.
- Drop zones appear as thin highlighted lines between items.
- Each item shows a visibility toggle (eye icon) to hide it.
- A "+ Add module" button at the bottom opens a list of currently hidden modules to restore them.
- Cursor changes to `grabbing` during drag.
- Save button is disabled until changes are made.

### Saving and Canceling

- **Save**: Computes changed positions, POSTs to API route, exits edit mode.
- **Cancel**: Discards draft state, exits edit mode, no API call.
- Escape key also cancels.

### State Management

- On enter: copy current module preferences into local draft state.
- Drag/hide/show operations mutate the draft only.
- On save: diff draft against original, persist only changed rows.
- On cancel: discard the draft.

## API

### Read Path

- `_layout.tsx` loader adds `getModulePreferences(client, userId, companyId)` to its existing `Promise.all`.
- Returns `{module, position, hidden}[]` (empty array if no customization).
- Passed through app context.

### Write Path

- New API route: `api+/module-preferences.tsx`.
- `action` accepts POST with the full draft: `{module, position, hidden}[]`.
- Upserts rows into `userModulePreference` using the unique constraint.
- Auth via `requirePermissions(request, {})` — no special permission needed.

### `useModules` Hook Changes

- Reads module preferences from context.
- If preferences exist: reorder by position, filter out hidden, then apply permission filtering.
- If no preferences: return hardcoded default order (backwards compatible).

### Fractional Position Calculation

- Between two items: `(prevPosition + nextPosition) / 2`
- Before first item: `firstItem.position - 1`
- After last item: `lastItem.position + 1`

## Edge Cases

- **New module added to codebase**: Appears at the bottom of the custom order (no preference row exists for it).
- **Module removed from codebase**: Orphaned rows are harmless — `useModules` only renders modules in the hardcoded list.
- **Permission revoked**: Permission filtering applies after custom ordering, so revoked modules never show.
- **First-time user**: No rows, defaults apply.
- **Company switch**: Preferences are per user/company, so switching loads a different set.

## Files to Create or Modify

| File | Action |
|------|--------|
| `packages/database/supabase/migrations/<timestamp>_menu-customization.sql` | Create table, RLS policies |
| `apps/erp/app/modules/settings/settings.service.ts` (or new module-level service) | `getModulePreferences`, `upsertModulePreferences` |
| `apps/erp/app/routes/api+/module-preferences.tsx` | API route for saving preferences |
| `apps/erp/app/routes/x+/_layout.tsx` | Add preference loading to loader |
| `apps/erp/app/hooks/useModules.tsx` | Merge preferences with hardcoded modules |
| `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx` | Edit mode UI, drag-and-drop, save/cancel bar |
| `apps/erp/app/components/Layout/Navigation/` | New sub-components: edit mode bar, sortable item, add-module popover |
