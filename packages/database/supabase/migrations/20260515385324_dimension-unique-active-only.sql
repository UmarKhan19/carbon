ALTER TABLE "dimension" DROP CONSTRAINT "dimension_name_companyGroupId_key";

CREATE UNIQUE INDEX "dimension_name_companyGroupId_active_idx"
  ON "dimension"("name", "companyGroupId")
  WHERE "active" = true;
