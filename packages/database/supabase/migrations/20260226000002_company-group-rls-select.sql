-- Allow authenticated users to read company groups they belong to
CREATE POLICY "Users can view their company groups" ON "companyGroup"
FOR SELECT USING (
  "id" IN (
    SELECT "companyGroupId" FROM "company"
    WHERE "id" = ANY (
      SELECT "companyId" FROM "userToCompany"
      WHERE "userId" = auth.uid()::text
    )
  )
);
