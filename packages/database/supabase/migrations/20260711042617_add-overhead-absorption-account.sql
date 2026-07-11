ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "overheadAbsorptionAccount" TEXT REFERENCES "account"("id") ON DELETE SET NULL;
