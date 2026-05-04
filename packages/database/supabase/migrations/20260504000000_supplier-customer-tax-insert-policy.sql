-- Allow employees with purchasing_update to insert into supplierTax
-- Needed for upsert when a supplier has no tax row yet (e.g. created before migration)
CREATE POLICY "INSERT" ON "public"."supplierTax"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

-- Same fix for customerTax to keep tables consistent
CREATE POLICY "INSERT" ON "public"."customerTax"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);
