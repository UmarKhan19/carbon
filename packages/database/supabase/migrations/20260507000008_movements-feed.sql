-- ============================================================
-- P2 — Factory-Wide Movements Feed
--
-- Single RPC returning every line currently in motion, unioned across:
--   - active stockTransfers (Draft / Released / In Progress)
--   - active pickingLists with a destination shelf set
--   - active outbound shipments (Draft / Pending)
--
-- Destination categories are derived live from
-- storageUnit.storageTypeIds → storageType.name. Shipments don't have
-- a "to shelf" — their destination is implicit Customer, surfaced as
-- a hard-coded chip in the UI.
--
-- No new tables. Pure UNION over existing data.
-- ============================================================

CREATE OR REPLACE FUNCTION get_inventory_movements(
  p_company_id  TEXT,
  p_location_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  "type"                    TEXT,
  "documentId"              TEXT,
  "ref"                     TEXT,
  "itemId"                  TEXT,
  "itemReadableId"          TEXT,
  "itemName"                TEXT,
  "quantity"                NUMERIC,
  "unitOfMeasureCode"       TEXT,
  "fromStorageUnitId"       TEXT,
  "fromStorageUnitName"     TEXT,
  "toStorageUnitId"         TEXT,
  "toStorageUnitName"       TEXT,
  "destinationCategories"   TEXT[],
  "assignee"                TEXT,
  "status"                  TEXT,
  "locationId"              TEXT,
  "createdAt"               TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  -- Arm 1: stock transfers (covers Shelf→Quarantine, Shelf→Scrap, etc.)
  SELECT
    'Stock Transfer'::text                              AS "type",
    st.id                                               AS "documentId",
    st."stockTransferId"                                AS "ref",
    stl."itemId",
    i."readableId"                                      AS "itemReadableId",
    i."name"                                            AS "itemName",
    stl."outstandingQuantity"                           AS "quantity",
    i."unitOfMeasureCode"                               AS "unitOfMeasureCode",
    stl."fromStorageUnitId",
    from_su."name"                                      AS "fromStorageUnitName",
    stl."toStorageUnitId",
    to_su."name"                                        AS "toStorageUnitName",
    (
      SELECT array_agg(stype."name")
      FROM "storageType" stype
      WHERE to_su."storageTypeIds" IS NOT NULL
        AND stype.id = ANY(to_su."storageTypeIds")
    )                                                   AS "destinationCategories",
    st."assignee",
    st."status"::text                                   AS "status",
    st."locationId",
    st."createdAt"
  FROM "stockTransferLine" stl
  JOIN "stockTransfer" st ON stl."stockTransferId" = st.id
  JOIN "item" i ON stl."itemId" = i.id
  LEFT JOIN "storageUnit" from_su ON stl."fromStorageUnitId" = from_su.id
  LEFT JOIN "storageUnit" to_su   ON stl."toStorageUnitId"   = to_su.id
  WHERE st."companyId" = p_company_id
    AND (p_location_id IS NULL OR st."locationId" = p_location_id)
    AND st."status" IN ('Draft','Released','In Progress')
    AND stl."outstandingQuantity" > 0

  UNION ALL

  -- Arm 2: picking list lines with a destination (line-side staging)
  SELECT
    'Picking List'::text,
    pl.id,
    pl."pickingListId",
    pll."itemId",
    i."readableId",
    i."name",
    pll."outstandingQuantity",
    pll."unitOfMeasureCode",
    pll."storageUnitId",
    src_su."name",
    pll."destinationStorageUnitId",
    dst_su."name",
    (
      SELECT array_agg(stype."name")
      FROM "storageType" stype
      WHERE dst_su."storageTypeIds" IS NOT NULL
        AND stype.id = ANY(dst_su."storageTypeIds")
    ),
    pl."assignee",
    pl."status"::text,
    pl."locationId",
    pll."createdAt"
  FROM "pickingListLine" pll
  JOIN "pickingList" pl ON pll."pickingListId" = pl.id
  JOIN "item" i ON pll."itemId" = i.id
  LEFT JOIN "storageUnit" src_su ON pll."storageUnitId"            = src_su.id
  LEFT JOIN "storageUnit" dst_su ON pll."destinationStorageUnitId" = dst_su.id
  WHERE pl."companyId" = p_company_id
    AND (p_location_id IS NULL OR pl."locationId" = p_location_id)
    AND pl."status" IN ('Released','In Progress')
    AND pll."outstandingQuantity" > 0
    AND pll."destinationStorageUnitId" IS NOT NULL

  UNION ALL

  -- Arm 3: outbound shipments (Shelf → Customer; no toShelf)
  SELECT
    'Shipment'::text,
    s.id,
    s."shipmentId",
    sl."itemId",
    i."readableId",
    i."name",
    GREATEST(sl."orderQuantity" - sl."shippedQuantity", 0),
    sl."unitOfMeasure",
    sl."storageUnitId",
    src_su."name",
    NULL::text,
    NULL::text,
    ARRAY['Customer']::text[],
    NULL::text,
    s."status"::text,
    sl."locationId",
    sl."createdAt"
  FROM "shipmentLine" sl
  JOIN "shipment" s ON sl."shipmentId" = s.id
  JOIN "item" i ON sl."itemId" = i.id
  LEFT JOIN "storageUnit" src_su ON sl."storageUnitId" = src_su.id
  WHERE s."companyId" = p_company_id
    AND (p_location_id IS NULL OR sl."locationId" = p_location_id)
    AND s."status" NOT IN ('Posted')
    AND (sl."orderQuantity" - sl."shippedQuantity") > 0

  ORDER BY "createdAt" DESC NULLS LAST, "type", "ref";
$$;
