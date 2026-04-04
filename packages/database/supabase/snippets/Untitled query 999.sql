CREATE POLICY "UPDATE" ON "public"."journal"
  FOR UPDATE
  USING (
    "status" = 'Draft'
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_update'))::text[]
    )
  )
  WITH CHECK (true);

CREATE POLICY "DELETE" ON "public"."journal"
  FOR DELETE USING (
    "status" = 'Draft'
    AND "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('accounting_delete'))::text[]
    )
  );