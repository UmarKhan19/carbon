-- Widen productionQuantity.quantity from INTEGER to NUMERIC so it can hold fractional
-- production for weight/length UoMs. Downstream consumers (jobOperation.quantityComplete,
-- itemLedger.quantity, jobMaterial.quantity*) are already NUMERIC.

ALTER TABLE "productionQuantity"
  ALTER COLUMN "quantity" TYPE NUMERIC USING "quantity"::NUMERIC;
