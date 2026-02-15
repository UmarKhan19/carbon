-- Add UPDATE policy for trackedEntity table
-- This allows users to update tracked entities (e.g., marking stock as "Consumed")

CREATE POLICY "UPDATE" ON "trackedEntity"
  FOR UPDATE
  TO public
  USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]))
  WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
