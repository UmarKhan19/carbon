-- Set the DB-level default costing method for new itemCost rows to FIFO.
--
-- Context: "itemCost"."costingMethod" is NOT NULL with no column default; the
-- value is supplied explicitly by the item-creation interceptor
-- (sync_create_item_related_records), which already inserts 'FIFO'
-- (since 20260410031802_item-interceptors). This statement makes the column
-- default consistent so any direct/raw insert that omits costingMethod also
-- defaults to FIFO rather than failing. Idempotent (re-run sets the same default).

ALTER TABLE "itemCost" ALTER COLUMN "costingMethod" SET DEFAULT 'FIFO';
