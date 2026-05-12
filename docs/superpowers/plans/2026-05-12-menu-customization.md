# Menu Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users reorder and hide ERP sidebar modules, persisted server-side per user/company.

**Architecture:** New `userModulePreference` table with fractional positioning. Layout loader fetches preferences alongside existing data. `useModules` merges preferences with hardcoded module list. PrimaryNavigation gains an edit mode with `@dnd-kit/sortable` drag-and-drop, visibility toggles, and a save/cancel bar.

**Tech Stack:** PostgreSQL (migration + RLS), Supabase client, React Router (loader + API route), `@dnd-kit/core` + `@dnd-kit/sortable`, React state

**Spec:** `docs/superpowers/specs/2026-05-12-menu-customization-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/database/supabase/migrations/<ts>_menu-customization.sql` | Create | Table, RLS policies |
| `apps/erp/app/modules/users/users.server.ts` | Modify | `getModulePreferences`, `upsertModulePreferences` service functions |
| `apps/erp/app/routes/x+/_layout.tsx` | Modify | Add `getModulePreferences` to loader `Promise.all` |
| `apps/erp/app/hooks/useModules.tsx` | Modify | Add `key` to each module, accept preferences, merge + reorder |
| `apps/erp/app/routes/api+/module-preferences.tsx` | Create | POST action to upsert preferences |
| `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx` | Modify | Edit mode, DnD context, save/cancel bar, visibility toggles |
| `apps/erp/app/components/Layout/Navigation/useNavigationEditMode.tsx` | Create | Hook encapsulating edit mode state, draft management, save logic |
| `apps/erp/app/components/Layout/Navigation/SortableNavItem.tsx` | Create | `useSortable` wrapper around NavigationIconLink for drag-and-drop |
| `apps/erp/app/components/Layout/Navigation/NavigationEditBar.tsx` | Create | Colored top bar with Save/Cancel buttons |
| `apps/erp/app/components/Layout/Navigation/HiddenModulesPopover.tsx` | Create | "+ Add module" button showing hidden modules |

---

### Task 1: Database Migration

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_menu-customization.sql`

- [ ] **Step 1: Generate migration timestamp**

Run: `date -u +"%Y%m%d%H%M%S"`

Use the output as the timestamp prefix for the migration file.

- [ ] **Step 2: Write the migration**

Create `packages/database/supabase/migrations/<timestamp>_menu-customization.sql`:

```sql
CREATE TABLE "userModulePreference" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "position" DOUBLE PRECISION NOT NULL,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "userModulePreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "userModulePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "userModulePreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "userModulePreference_userId_companyId_module_key" UNIQUE ("userId", "companyId", "module")
);

ALTER TABLE "userModulePreference" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "userModulePreference"
  FOR SELECT USING ("userId" = auth.uid()::text);

CREATE POLICY "INSERT" ON "userModulePreference"
  FOR INSERT WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "UPDATE" ON "userModulePreference"
  FOR UPDATE USING ("userId" = auth.uid()::text);

CREATE POLICY "DELETE" ON "userModulePreference"
  FOR DELETE USING ("userId" = auth.uid()::text);

CREATE INDEX "userModulePreference_userId_companyId_idx"
  ON "userModulePreference" ("userId", "companyId");
```

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/*_menu-customization.sql
git commit -m "feat: add userModulePreference table for menu customization"
```

---

### Task 2: Service Functions

**Files:**
- Modify: `apps/erp/app/modules/users/users.server.ts` (add two functions near `getUserDefaults`)

- [ ] **Step 1: Add `getModulePreferences` function**

Add this function to `apps/erp/app/modules/users/users.server.ts`, near the existing `getUserDefaults` function:

```typescript
export async function getModulePreferences(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("userModulePreference")
    .select("module, position, hidden")
    .eq("userId", userId)
    .eq("companyId", companyId)
    .order("position");
}
```

- [ ] **Step 2: Add `upsertModulePreferences` function**

Add this function below `getModulePreferences`:

```typescript
export async function upsertModulePreferences(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  preferences: { module: string; position: number; hidden: boolean }[]
) {
  return client.from("userModulePreference").upsert(
    preferences.map((p) => ({
      userId,
      companyId,
      module: p.module,
      position: p.position,
      hidden: p.hidden,
      updatedAt: new Date().toISOString(),
    })),
    { onConflict: "userId,companyId,module" }
  );
}
```

- [ ] **Step 3: Verify the import of `SupabaseClient` and `Database` types**

These should already be imported at the top of `users.server.ts`. Confirm they exist — do not add duplicate imports.

- [ ] **Step 4: Commit**

```bash
git add apps/erp/app/modules/users/users.server.ts
git commit -m "feat: add getModulePreferences and upsertModulePreferences service functions"
```

---

### Task 3: Layout Loader Update

**Files:**
- Modify: `apps/erp/app/routes/x+/_layout.tsx`

- [ ] **Step 1: Add import**

Add `getModulePreferences` to the existing import from `~/modules/users/users.server`:

```typescript
import {
  getUser,
  getUserClaims,
  getUserDefaults,
  getUserGroups,
  getModulePreferences,
} from "~/modules/users/users.server";
```

- [ ] **Step 2: Add to `Promise.all` in loader**

Add `getModulePreferences(client, userId, companyId)` to the `Promise.all` array, and add `modulePreferences` to the destructured result:

```typescript
const [
  companies,
  stripeCustomer,
  customFields,
  integrations,
  companySettings,
  savedViews,
  user,
  claims,
  groups,
  defaults,
  auditLogEnabled,
  modulePreferences,
] = await Promise.all([
  getCompanies(client, userId),
  getStripeCustomerByCompanyId(companyId, userId),
  getCustomFieldsSchemas(client, { companyId }),
  getCompanyIntegrations(client, companyId),
  getCompanySettings(client, companyId),
  getSavedViews(client, userId, companyId),
  getUser(client, userId),
  getUserClaims(userId, companyId),
  getUserGroups(client, userId),
  getUserDefaults(client, userId, companyId),
  isAuditLogEnabled(client, companyId),
  getModulePreferences(client, userId, companyId),
]);
```

- [ ] **Step 3: Add `modulePreferences` to returned data**

Add to the `return data({...})` object:

```typescript
modulePreferences: modulePreferences.data ?? [],
```

- [ ] **Step 4: Commit**

```bash
git add apps/erp/app/routes/x+/_layout.tsx
git commit -m "feat: load module preferences in layout loader"
```

---

### Task 4: Update `useModules` Hook

**Files:**
- Modify: `apps/erp/app/hooks/useModules.tsx`

- [ ] **Step 1: Add `key` field to each module and add `useRouteData` import**

Each module needs a stable string key for the preference table. Use the `permission` value where it exists, and a custom string for role-based modules.

Update the imports to add `useRouteData` from `@carbon/react` and `path` from `~/utils/path`:

```typescript
import { useRouteData } from "@carbon/react";
```

Note: `path` is already imported.

- [ ] **Step 2: Add `key` to each module in the array**

Add a `key` field to the `Authenticated<NavItem>` type usage. Update the modules array — each item gets a `key`:

```typescript
const modules: (Authenticated<NavItem> & { key: string })[] = [
  {
    key: "shopFloor",
    name: t`Shop Floor`,
    to: path.to.external.mes,
    icon: LuTvMinimalPlay,
    role: "employee",
  },
  {
    key: "sales",
    permission: "sales",
    name: t`Sales`,
    to: path.to.sales,
    icon: LuCrown,
  },
  {
    key: "production",
    permission: "production",
    name: t`Production`,
    to: path.to.production,
    icon: LuFactory,
  },
  {
    key: "parts",
    permission: "parts",
    name: t`Items`,
    to: path.to.parts,
    icon: LuSquareStack,
  },
  {
    key: "inventory",
    permission: "inventory",
    name: t`Inventory`,
    to: path.to.inventory,
    icon: LuBox,
  },
  {
    key: "purchasing",
    permission: "purchasing",
    name: t`Purchasing`,
    to: path.to.purchasing,
    icon: LuShoppingCart,
  },
  {
    key: "quality",
    permission: "quality",
    name: t`Quality`,
    to: path.to.quality,
    icon: LuFolderCheck,
  },
  {
    key: "accounting",
    permission: "accounting",
    name: t`Accounting`,
    to: path.to.chartOfAccounts,
    icon: LuLandmark,
  },
  {
    key: "people",
    permission: "people",
    name: t`People`,
    to: path.to.people,
    icon: LuUsers,
  },
  {
    key: "resources",
    permission: "resources",
    name: t`Resources`,
    to: path.to.resources,
    icon: LuWrench,
  },
  {
    key: "documents",
    permission: "documents",
    name: t`Documents`,
    to: path.to.documents,
    icon: LuFiles,
  },
  {
    key: "users",
    permission: "users",
    name: t`Users`,
    to: path.to.employeeAccounts,
    icon: LuShield,
  },
  {
    key: "settings",
    permission: "settings",
    name: t`Settings`,
    to: path.to.company,
    icon: LuSettings,
  },
];
```

- [ ] **Step 3: Read preferences from route data and merge**

Replace the existing `return modules.filter(...)` block with logic that reads preferences and merges:

```typescript
type ModulePreference = {
  module: string;
  position: number;
  hidden: boolean;
};

const routeData = useRouteData<{
  modulePreferences: ModulePreference[];
}>(path.to.authenticatedRoot);

const modulePreferences = routeData?.modulePreferences ?? [];

// Filter by permissions first
const permitted = modules.filter((item) => {
  if (item.permission) {
    return permissions.can("view", item.permission);
  } else if (item.role) {
    return permissions.is(item.role);
  } else {
    return true;
  }
});

// If no preferences, return default order
if (modulePreferences.length === 0) {
  return permitted;
}

// Build a lookup for preferences
const prefMap = new Map(
  modulePreferences.map((p) => [p.module, p])
);

// Filter out hidden modules, then sort by position
const visible = permitted.filter((m) => {
  const pref = prefMap.get(m.key);
  return !pref?.hidden;
});

return visible.sort((a, b) => {
  const posA = prefMap.get(a.key)?.position ?? Infinity;
  const posB = prefMap.get(b.key)?.position ?? Infinity;
  return posA - posB;
});
```

- [ ] **Step 4: Extract module definitions into a shared helper and export `useAllModules`**

To avoid duplicating the modules array, extract it into a function that both hooks call. Add this above `useModules`:

```typescript
type ModuleDefinition = Authenticated<NavItem> & { key: string };

function getModuleDefinitions(t: ReturnType<typeof useLingui>["t"]): ModuleDefinition[] {
  return [
    {
      key: "shopFloor",
      name: t`Shop Floor`,
      to: path.to.external.mes,
      icon: LuTvMinimalPlay,
      role: "employee",
    },
    {
      key: "sales",
      permission: "sales",
      name: t`Sales`,
      to: path.to.sales,
      icon: LuCrown,
    },
    {
      key: "production",
      permission: "production",
      name: t`Production`,
      to: path.to.production,
      icon: LuFactory,
    },
    {
      key: "parts",
      permission: "parts",
      name: t`Items`,
      to: path.to.parts,
      icon: LuSquareStack,
    },
    {
      key: "inventory",
      permission: "inventory",
      name: t`Inventory`,
      to: path.to.inventory,
      icon: LuBox,
    },
    {
      key: "purchasing",
      permission: "purchasing",
      name: t`Purchasing`,
      to: path.to.purchasing,
      icon: LuShoppingCart,
    },
    {
      key: "quality",
      permission: "quality",
      name: t`Quality`,
      to: path.to.quality,
      icon: LuFolderCheck,
    },
    {
      key: "accounting",
      permission: "accounting",
      name: t`Accounting`,
      to: path.to.chartOfAccounts,
      icon: LuLandmark,
    },
    {
      key: "people",
      permission: "people",
      name: t`People`,
      to: path.to.people,
      icon: LuUsers,
    },
    {
      key: "resources",
      permission: "resources",
      name: t`Resources`,
      to: path.to.resources,
      icon: LuWrench,
    },
    {
      key: "documents",
      permission: "documents",
      name: t`Documents`,
      to: path.to.documents,
      icon: LuFiles,
    },
    {
      key: "users",
      permission: "users",
      name: t`Users`,
      to: path.to.employeeAccounts,
      icon: LuShield,
    },
    {
      key: "settings",
      permission: "settings",
      name: t`Settings`,
      to: path.to.company,
      icon: LuSettings,
    },
  ];
}
```

Then update `useModules` to call `const modules = getModuleDefinitions(t);` instead of declaring the array inline.

Add `useAllModules` below `useModules`:

```typescript
export function useAllModules() {
  const permissions = usePermissions();
  const { t } = useLingui();

  const modules = getModuleDefinitions(t);

  const routeData = useRouteData<{
    modulePreferences: ModulePreference[];
  }>(path.to.authenticatedRoot);

  const modulePreferences = routeData?.modulePreferences ?? [];

  const permitted = modules.filter((item) => {
    if (item.permission) {
      return permissions.can("view", item.permission);
    } else if (item.role) {
      return permissions.is(item.role);
    } else {
      return true;
    }
  });

  const prefMap = new Map(
    modulePreferences.map((p) => [p.module, p])
  );

  return permitted.map((m, index) => ({
    ...m,
    position: prefMap.get(m.key)?.position ?? index + 1,
    hidden: prefMap.get(m.key)?.hidden ?? false,
  })).sort((a, b) => a.position - b.position);
}
```

To avoid duplicating the modules array, extract it into a helper function `getModuleDefinitions(t)` that both `useModules` and `useAllModules` call. This function takes the `t` macro from lingui and returns the modules array.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/hooks/useModules.tsx
git commit -m "feat: useModules merges user preferences with hardcoded module list"
```

---

### Task 5: API Route for Saving Preferences

**Files:**
- Create: `apps/erp/app/routes/api+/module-preferences.tsx`

- [ ] **Step 1: Create the API route**

Create `apps/erp/app/routes/api+/module-preferences.tsx`:

```typescript
import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertModulePreferences } from "~/modules/users/users.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {});

  const body = (await request.json()) as {
    preferences: { module: string; position: number; hidden: boolean }[];
  };

  if (!Array.isArray(body.preferences)) {
    return data({ error: "Invalid preferences format" }, { status: 400 });
  }

  const result = await upsertModulePreferences(
    client,
    userId,
    companyId,
    body.preferences
  );

  if (result.error) {
    return data({ error: result.error.message }, { status: 500 });
  }

  return data({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/app/routes/api+/module-preferences.tsx
git commit -m "feat: add API route for saving module preferences"
```

---

### Task 6: Navigation Edit Mode Hook

**Files:**
- Create: `apps/erp/app/components/Layout/Navigation/useNavigationEditMode.tsx`

- [ ] **Step 1: Create the edit mode hook**

This hook manages all edit mode state: entering/exiting, draft management, drag handling, save/cancel.

Create `apps/erp/app/components/Layout/Navigation/useNavigationEditMode.tsx`:

```typescript
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";
import { useRevalidator } from "react-router";
import { useAllModules } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";

export type DraftModule = Authenticated<NavItem> & {
  key: string;
  position: number;
  hidden: boolean;
};

export function useNavigationEditMode() {
  const allModules = useAllModules();
  const revalidator = useRevalidator();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DraftModule[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const originalRef = useMemo(() => {
    return allModules.map((m, i) => ({
      ...m,
      position: m.position ?? i + 1,
      hidden: m.hidden ?? false,
    }));
  }, [allModules]);

  const enterEditMode = useCallback(() => {
    setDraft(originalRef.map((m) => ({ ...m })));
    setIsEditing(true);
  }, [originalRef]);

  const cancelEditMode = useCallback(() => {
    setDraft([]);
    setIsEditing(false);
  }, []);

  const visibleDraft = useMemo(
    () => draft.filter((m) => !m.hidden),
    [draft]
  );

  const hiddenDraft = useMemo(
    () => draft.filter((m) => m.hidden),
    [draft]
  );

  const isDirty = useMemo(() => {
    if (draft.length === 0) return false;
    return draft.some((d) => {
      const orig = originalRef.find((o) => o.key === d.key);
      if (!orig) return true;
      return d.position !== orig.position || d.hidden !== orig.hidden;
    });
  }, [draft, originalRef]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setDraft((prev) => {
      const visible = prev.filter((m) => !m.hidden);
      const hidden = prev.filter((m) => m.hidden);

      const oldIndex = visible.findIndex((m) => m.key === active.id);
      const newIndex = visible.findIndex((m) => m.key === over.id);

      if (oldIndex === -1 || newIndex === -1) return prev;

      const reordered = arrayMove(visible, oldIndex, newIndex);

      // Recalculate positions using fractional indexing
      const repositioned = reordered.map((m, i) => ({
        ...m,
        position: i + 1,
      }));

      return [...repositioned, ...hidden];
    });
  }, []);

  const toggleHidden = useCallback((key: string) => {
    setDraft((prev) => {
      const updated = prev.map((m) =>
        m.key === key ? { ...m, hidden: !m.hidden } : m
      );
      // Recalculate visible positions
      const visible = updated.filter((m) => !m.hidden);
      const hidden = updated.filter((m) => m.hidden);
      return [
        ...visible.map((m, i) => ({ ...m, position: i + 1 })),
        ...hidden,
      ];
    });
  }, []);

  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/module-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: draft.map((m) => ({
            module: m.key,
            position: m.position,
            hidden: m.hidden,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save preferences");
      }

      setIsEditing(false);
      setDraft([]);
      revalidator.revalidate();
    } finally {
      setIsSaving(false);
    }
  }, [draft, revalidator]);

  return {
    isEditing,
    isSaving,
    isDirty,
    visibleDraft,
    hiddenDraft,
    enterEditMode,
    cancelEditMode,
    handleDragEnd,
    toggleHidden,
    save,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/app/components/Layout/Navigation/useNavigationEditMode.tsx
git commit -m "feat: add useNavigationEditMode hook for edit mode state management"
```

---

### Task 7: SortableNavItem Component

**Files:**
- Create: `apps/erp/app/components/Layout/Navigation/SortableNavItem.tsx`

- [ ] **Step 1: Create the sortable item wrapper**

This wraps a navigation link with `useSortable` from dnd-kit for drag-and-drop. In edit mode it shows a drag handle and a visibility toggle instead of navigating.

Create `apps/erp/app/components/Layout/Navigation/SortableNavItem.tsx`:

```typescript
import { cn } from "@carbon/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LuEyeOff, LuGripVertical } from "react-icons/lu";
import type { DraftModule } from "./useNavigationEditMode";

type SortableNavItemProps = {
  module: DraftModule;
  isOpen: boolean;
  onToggleHidden: (key: string) => void;
};

export function SortableNavItem({
  module,
  isOpen,
  onToggleHidden,
}: SortableNavItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: module.key });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const iconClasses =
    "absolute left-3 top-3 flex items-center justify-center";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative",
        "h-10 w-10 group-data-[state=expanded]:w-full",
        "flex items-center rounded-md",
        "group-data-[state=collapsed]:justify-center",
        "group-data-[state=expanded]:-space-x-2",
        "font-medium shrink-0 inline-flex select-none",
        "transition-[background-color,color,width] duration-100 ease-out",
        "hover:bg-accent hover:text-accent-foreground",
        "border border-transparent",
        isDragging && "opacity-50 border-primary",
        "group/item"
      )}
    >
      {/* Drag handle — visible when sidebar is expanded */}
      <div
        className={cn(
          "absolute left-0 top-0 h-full flex items-center pl-1",
          "opacity-0 group-data-[state=expanded]:opacity-100",
          "cursor-grab active:cursor-grabbing"
        )}
        {...attributes}
        {...listeners}
      >
        <LuGripVertical className="w-3 h-3 text-muted-foreground" />
      </div>

      {/* Module icon */}
      <module.icon className={cn(iconClasses)} />

      {/* Module name */}
      <span
        className={cn(
          "min-w-[128px] text-sm",
          "absolute left-7 group-data-[state=expanded]:left-12",
          "opacity-0 group-data-[state=expanded]:opacity-100"
        )}
      >
        {module.name}
      </span>

      {/* Hide button — visible when sidebar is expanded */}
      <button
        type="button"
        onClick={() => onToggleHidden(module.key)}
        className={cn(
          "absolute right-2 top-2.5 p-0.5 rounded",
          "opacity-0 group-data-[state=expanded]:opacity-100",
          "text-muted-foreground hover:text-foreground",
          "transition-opacity"
        )}
      >
        <LuEyeOff className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/app/components/Layout/Navigation/SortableNavItem.tsx
git commit -m "feat: add SortableNavItem component for drag-and-drop in edit mode"
```

---

### Task 8: NavigationEditBar Component

**Files:**
- Create: `apps/erp/app/components/Layout/Navigation/NavigationEditBar.tsx`

- [ ] **Step 1: Create the edit bar**

The colored bar that appears at the top of the sidebar during edit mode, containing "Menu customization" title and Save/Cancel buttons.

Create `apps/erp/app/components/Layout/Navigation/NavigationEditBar.tsx`:

```typescript
import { Button, cn } from "@carbon/react";
import { LuX } from "react-icons/lu";

type NavigationEditBarProps = {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
};

export function NavigationEditBar({
  isSaving,
  isDirty,
  onSave,
  onCancel,
}: NavigationEditBarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-2 py-2",
        "bg-primary text-primary-foreground",
        "rounded-md"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium truncate">Customize</span>
        <button
          type="button"
          onClick={onCancel}
          className="p-0.5 rounded hover:bg-primary-foreground/20"
        >
          <LuX className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={onCancel}
          disabled={isSaving}
          className="flex-1 h-7 text-xs"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          className="flex-1 h-7 text-xs"
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/app/components/Layout/Navigation/NavigationEditBar.tsx
git commit -m "feat: add NavigationEditBar component for edit mode header"
```

---

### Task 9: HiddenModulesPopover Component

**Files:**
- Create: `apps/erp/app/components/Layout/Navigation/HiddenModulesPopover.tsx`

- [ ] **Step 1: Create the hidden modules popover**

A button at the bottom of the sidebar (in edit mode) that shows hidden modules and lets users re-enable them.

Create `apps/erp/app/components/Layout/Navigation/HiddenModulesPopover.tsx`:

```typescript
import { cn, Popover, PopoverContent, PopoverTrigger } from "@carbon/react";
import { LuPlus } from "react-icons/lu";
import type { DraftModule } from "./useNavigationEditMode";

type HiddenModulesPopoverProps = {
  hiddenModules: DraftModule[];
  onToggleHidden: (key: string) => void;
};

export function HiddenModulesPopover({
  hiddenModules,
  onToggleHidden,
}: HiddenModulesPopoverProps) {
  if (hiddenModules.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative",
            "h-10 w-10 group-data-[state=expanded]:w-full",
            "flex items-center rounded-md",
            "group-data-[state=collapsed]:justify-center",
            "font-medium shrink-0 inline-flex select-none",
            "text-muted-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "transition-[background-color,color,width] duration-100 ease-out"
          )}
        >
          <LuPlus className="absolute left-3 top-3 flex items-center justify-center" />
          <span
            className={cn(
              "min-w-[128px] text-sm",
              "absolute left-7 group-data-[state=expanded]:left-12",
              "opacity-0 group-data-[state=expanded]:opacity-100"
            )}
          >
            Add module
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-48 p-1">
        {hiddenModules.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => onToggleHidden(m.key)}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 rounded-sm",
              "text-sm text-left",
              "hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <m.icon className="w-4 h-4" />
            {m.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/app/components/Layout/Navigation/HiddenModulesPopover.tsx
git commit -m "feat: add HiddenModulesPopover for restoring hidden modules"
```

---

### Task 10: Update PrimaryNavigation with Edit Mode

**Files:**
- Modify: `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx`
- Modify: `apps/erp/app/components/Layout/Navigation/index.ts`

- [ ] **Step 1: Rewrite PrimaryNavigation to support edit mode**

Replace the full content of `PrimaryNavigation.tsx`. The key changes:
- Add DndContext + SortableContext wrapping the module list in edit mode
- Show NavigationEditBar at the top when editing
- Render SortableNavItem instead of NavigationIconLink when editing
- Show HiddenModulesPopover at the bottom when editing
- Add a wrench button to enter edit mode
- Listen for Escape key to cancel

```typescript
import { cn, useDisclosure, VStack } from "@carbon/react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { AnchorHTMLAttributes } from "react";
import { forwardRef, memo, useCallback, useEffect } from "react";
import { Link, useMatches } from "react-router";
import { LuWrench } from "react-icons/lu";
import { useModules, useOptimisticLocation } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";
import { useNavigationEditMode } from "./useNavigationEditMode";
import { NavigationEditBar } from "./NavigationEditBar";
import { SortableNavItem } from "./SortableNavItem";
import { HiddenModulesPopover } from "./HiddenModulesPopover";

const PrimaryNavigation = () => {
  const navigationPanel = useDisclosure();
  const location = useOptimisticLocation();
  const currentModule = getModule(location.pathname);
  const links = useModules();
  const matchedModules = useMatches().reduce((acc, match) => {
    const handle = match.handle as { module?: string } | undefined;
    if (handle && typeof handle.module === "string") {
      acc.add(handle.module);
    }
    return acc;
  }, new Set<string>());

  const editMode = useNavigationEditMode();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // Escape key cancels edit mode
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && editMode.isEditing) {
        editMode.cancelEditMode();
      }
    },
    [editMode]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Keep sidebar open while editing
  const isOpen = navigationPanel.isOpen || editMode.isEditing;

  return (
    <div className="w-14 h-full flex-col z-50 hidden sm:flex">
      <nav
        data-state={isOpen ? "expanded" : "collapsed"}
        className={cn(
          "bg-background py-2 group z-10 h-full w-14 data-[state=expanded]:w-[13rem]",
          "flex flex-col justify-between data-[state=expanded]:shadow-xl data-[state=expanded]:border-r data-[state=expanded]:border-border",
          "transition-width duration-200",
          "hide-scrollbar overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
        )}
        onMouseEnter={editMode.isEditing ? undefined : navigationPanel.onOpen}
        onMouseLeave={editMode.isEditing ? undefined : navigationPanel.onClose}
      >
        <VStack
          spacing={1}
          className="flex flex-col justify-between h-full px-2"
        >
          <VStack spacing={1}>
            {editMode.isEditing && (
              <NavigationEditBar
                isSaving={editMode.isSaving}
                isDirty={editMode.isDirty}
                onSave={editMode.save}
                onCancel={editMode.cancelEditMode}
              />
            )}

            {editMode.isEditing ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={editMode.handleDragEnd}
              >
                <SortableContext
                  items={editMode.visibleDraft.map((m) => m.key)}
                  strategy={verticalListSortingStrategy}
                >
                  {editMode.visibleDraft.map((module) => (
                    <SortableNavItem
                      key={module.key}
                      module={module}
                      isOpen={isOpen}
                      onToggleHidden={editMode.toggleHidden}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              links.map((link) => {
                const m = getModule(link.to);
                const moduleMatches = matchedModules.has(m);
                const isActive = currentModule === m || moduleMatches;
                return (
                  <NavigationIconLink
                    key={link.name}
                    link={link}
                    isActive={isActive}
                    isOpen={isOpen}
                    onClick={navigationPanel.onClose}
                  />
                );
              })
            )}

            {editMode.isEditing && (
              <HiddenModulesPopover
                hiddenModules={editMode.hiddenDraft}
                onToggleHidden={editMode.toggleHidden}
              />
            )}
          </VStack>

          {/* Edit mode trigger button */}
          {!editMode.isEditing && (
            <button
              type="button"
              onClick={editMode.enterEditMode}
              className={cn(
                "relative",
                "h-10 w-10 group-data-[state=expanded]:w-full",
                "flex items-center rounded-md",
                "group-data-[state=collapsed]:justify-center",
                "group-data-[state=expanded]:-space-x-2",
                "font-medium shrink-0 inline-flex select-none",
                "text-muted-foreground",
                "hover:bg-accent hover:text-accent-foreground",
                "transition-[background-color,color,width] duration-100 ease-out"
              )}
            >
              <LuWrench className="absolute left-3 top-3 flex items-center justify-center" />
              <span
                className={cn(
                  "min-w-[128px] text-sm",
                  "absolute left-7 group-data-[state=expanded]:left-12",
                  "opacity-0 group-data-[state=expanded]:opacity-100"
                )}
              >
                Customize
              </span>
            </button>
          )}
        </VStack>
      </nav>
    </div>
  );
};

interface NavigationIconButtonProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  link: Authenticated<NavItem>;
  isActive?: boolean;
  isOpen?: boolean;
}

const NavigationIconLink = forwardRef<
  HTMLAnchorElement,
  NavigationIconButtonProps
>(({ link, isActive = false, isOpen = false, onClick, ...props }, ref) => {
  const iconClasses = [
    "absolute left-3 top-3 flex items-center items-center justify-center",
  ];

  const classes = [
    "relative",
    "h-10 w-10 group-data-[state=expanded]:w-full",
    "flex items-center rounded-md",
    "group-data-[state=collapsed]:justify-center",
    "group-data-[state=expanded]:-space-x-2",
    "font-medium shrink-0 inline-flex items-center justify-center select-none",
    "disabled:opacity-50",
    "transition-[background-color,color,width] duration-100 ease-out",
    "focus:!outline-none focus:!ring-0 active:!outline-none active:!ring-0",
    "after:pointer-events-none after:absolute after:-inset-[3px] after:rounded-lg after:border after:border-blue-500 after:opacity-0 after:ring-2 after:ring-blue-500/20 after:transition-opacity focus-visible:after:opacity-100 active:after:opacity-0",
    !isActive && "hover:bg-accent hover:text-accent-foreground",
    isActive && "bg-active text-active-foreground dark:shadow-button-base",
    "group/item",
  ];

  return (
    <Link
      role="button"
      aria-current={isActive}
      ref={ref}
      to={link.to}
      {...props}
      onClick={onClick}
      className={cn(classes, props.className)}
      prefetch="intent"
    >
      <link.icon className={cn(...iconClasses)} />
      <span
        aria-hidden={isOpen || undefined}
        className={cn(
          "min-w-[128px] text-sm",
          "absolute left-7 group-data-[state=expanded]:left-12",
          "opacity-0 group-data-[state=expanded]:opacity-100"
        )}
      >
        {link.name}
      </span>
    </Link>
  );
});
NavigationIconLink.displayName = "NavigationIconLink";

export default memo(PrimaryNavigation);

export function getModule(link: string) {
  return link.split("/")?.[2];
}
```

- [ ] **Step 2: Update the Navigation index export**

No changes needed — `PrimaryNavigation` is already exported as default and re-exported from `index.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx
git commit -m "feat: add edit mode to PrimaryNavigation with drag-and-drop and visibility toggles"
```

---

### Task 11: Manual Testing

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Open the ERP in a browser and verify default state**

Navigate to the ERP. The sidebar should display all modules in the default hardcoded order — identical to before these changes (no preferences rows exist yet).

- [ ] **Step 3: Test entering edit mode**

Click the wrench/Customize button at the bottom of the sidebar. Verify:
- Sidebar stays expanded
- Blue edit bar appears at top with Save (disabled) and Cancel buttons
- Modules show drag handles and eye-off icons
- Clicking a module does NOT navigate

- [ ] **Step 4: Test drag-and-drop reordering**

Drag a module (e.g. Accounting) to a different position. Verify:
- The module moves to the new position visually
- Save button becomes enabled
- Other modules shift to accommodate

- [ ] **Step 5: Test hiding a module**

Click the eye-off icon on a module. Verify:
- The module disappears from the visible list
- The "+ Add module" button appears at the bottom
- Clicking "+ Add module" shows a popover with the hidden module
- Clicking the hidden module in the popover restores it to the visible list

- [ ] **Step 6: Test saving**

After reordering and/or hiding modules, click Save. Verify:
- Edit mode exits
- The sidebar reflects the new order
- Refreshing the page preserves the order (server-side persistence)

- [ ] **Step 7: Test canceling**

Enter edit mode, make changes, then click Cancel (or press Escape). Verify:
- Edit mode exits
- The sidebar reverts to the previously saved order

- [ ] **Step 8: Test with a fresh user**

If possible, log in as a different user. Verify:
- They see the default module order (no customization)
- Their customizations are independent from the first user

- [ ] **Step 9: Commit any fixes from testing**

If any issues were found and fixed during testing, commit those fixes.
