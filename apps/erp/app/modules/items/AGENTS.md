# Items Module

Master data for all item types (Parts, Materials, Tools, Consumables, Services), bill of materials (methods), unit of measure management, material taxonomy, item costing, shelf life, configurations, supersessions, and item posting groups.

## Key Domain Concepts

- **Item Types** — Parts (manufactured/purchased goods), Materials (raw materials with taxonomy), Tools, Consumables, Services. All share the `item` table; type-specific tables (`part`, `material`, `tool`, `consumable`) extend it.
- **Make Methods** — versioned manufacturing methods on an item: BOM (materials) + routing (operations). Managed via `methodMaterial` and `methodOperation` tables. Copied to jobs by the `get-method` edge function.
- **Material Taxonomy** — Materials have structured properties via FK relationships: `materialSubstance` (steel, aluminum), `materialForm` (sheet, plate, roundbar), `materialType`, `materialGrade`, `materialFinish`, `materialDimension`. See `.claude/rules/material-tables.md`.
- **Item Tracking** — `itemTrackingType`: Inventory (quantity only), Serial (unique per unit), Batch (lot-tracked), Non-Inventory (not stocked).
- **Replenishment System** — Buy, Make, or Buy and Make. Drives MRP and method availability.
- **Shelf Life** — batch/serial items can have expiry tracking (Fixed Duration, Calculated, Set on Receipt).
- **Configurations** — parametric product configurators with parameters, groups, and rules.
- **Supersessions** — item replacement chains for obsolete parts.

## Safety

### Always
- Use `upsertMaterial` for material creation — it handles both `item` and `material` table inserts with the `readableId` linkage.
- Remember: `material.id` = `item.readableId`, NOT `item.id`. Join via `readableId + companyId`.
- Use `assertMethodOperationIsDraft` before deleting method operations — active methods are protected.
- Use the `convert` edge function for method version activation (`activateMethodVersion`).

### Ask First
- Deleting items that have inventory, open POs, or active jobs.
- Changing `itemTrackingType` on items that already have tracked entities.
- Modifying active method versions — create a new version instead.

### Never
- Directly insert `material` rows without corresponding `item` rows.
- Assume `material` has an `itemId` column — it was dropped; linkage is via `material.id = item.readableId`.
- Delete global taxonomy rows (`companyId IS NULL`) — they're system-seeded and shared across companies.

## Key Data Model

| Table / View | Purpose |
|---|---|
| `item` | Universal item master: readableId, name, type, tracking, replenishment, UoM |
| `part` / `material` / `tool` / `consumable` | Type-specific extensions |
| `materialForm` / `materialSubstance` / `materialType` / `materialGrade` / `materialFinish` / `materialDimension` | Material taxonomy (global or company-scoped) |
| `makeMethod` | Versioned manufacturing method header on an item |
| `methodMaterial` / `methodOperation` | BOM lines and routing steps within a method |
| `itemReplenishment` | Manufacturing settings: lot size, lead time, scrap % |
| `itemCost` / `itemCostHistory` | Standard/average costs and history |
| `itemUnitSalePrice` | Base selling price |
| `itemPostingGroup` | Maps item categories to GL accounts |
| `unitOfMeasure` | UoM definitions and conversion factors |
| `configurationParameter` / `configurationRule` | Product configurator |
| `supplierPart` | Supplier-item pricing (managed here, used by purchasing) |
| `pickMethod` | Default storage unit and pick strategy per item |

## Key Service Functions

- `getItem`, `getPart`, `getMaterial`, `getConsumable`, `getTool` — item reads by type
- `upsertMaterial` — creates/updates material with taxonomy FKs
- `getMakeMethods`, `getMethodMaterials`, `getMethodOperations`, `getMethodTreeArray`
- `copyItem`, `copyMakeMethod` — duplicates methods via edge function
- `createRevision`, `activateMethodVersion` — revision management
- `getItemCost`, `getItemQuantities`, `getItemDemand`, `getItemSupply`
- `getSupplierParts`, `getSupplierPriceBreaksForItems` — vendor pricing
- `getConfigurationParameters`, `getConfigurationRules` — configurator

## Related Modules

- **purchasing** — supplier parts pricing; PO lines reference items
- **inventory** — quantities tracked per item/location; tracking type drives behavior
- **production** — jobs manufacture items; methods are copied to jobs
- **sales** — quote lines and sales order lines reference items; `itemUnitSalePrice` is the base price
- **accounting** — `itemPostingGroup` maps items to GL accounts
- **quality** — inspections reference items; `requiresInspection` flag on items

## Rules References

- `.claude/rules/material-tables.md` — material taxonomy schema, linkage, and gotchas
- `.claude/rules/method-material-sourcing.md` — how methods determine Buy/Make/Pull sourcing
