ALTER TABLE "riskRegister" ADD COLUMN "updatedBy" TEXT;

ALTER TABLE "riskRegister" ADD CONSTRAINT "riskRegister_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL;