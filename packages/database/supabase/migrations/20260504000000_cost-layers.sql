-- Add remainingQuantity to costLedger for FIFO/LIFO cost layers
ALTER TABLE "costLedger"
  ADD COLUMN IF NOT EXISTS "remainingQuantity" NUMERIC(12, 4) NOT NULL DEFAULT 0;

CREATE INDEX "costLedger_itemId_remainingQuantity_idx"
  ON "costLedger" ("itemId", "remainingQuantity")
  WHERE "remainingQuantity" > 0;

-- Add laborAbsorptionAccount to accountDefault
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "laborAbsorptionAccount" TEXT REFERENCES "account" ("id");
