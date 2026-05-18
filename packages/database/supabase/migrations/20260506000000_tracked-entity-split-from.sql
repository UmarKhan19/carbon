-- Track which entity a remainder was split from during picking list confirmation.
-- Used by reversePickingList to merge split remainders back into the original.
ALTER TABLE "trackedEntity"
  ADD COLUMN IF NOT EXISTS "splitFromEntityId" TEXT NULL
    REFERENCES "trackedEntity"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracked_entity_split_from
  ON "trackedEntity" ("splitFromEntityId")
  WHERE "splitFromEntityId" IS NOT NULL;
