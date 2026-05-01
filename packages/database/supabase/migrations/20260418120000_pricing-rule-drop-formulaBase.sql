-- Drop the unused formulaBase column from pricingRule. The evaluator never
-- read it, and the selection it was meant to control (compute percentage
-- markups from cost vs. sale price) is not part of the current pricing model.
ALTER TABLE "pricingRule" DROP COLUMN IF EXISTS "formulaBase";
