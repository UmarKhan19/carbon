-- Allow assigned users to read their own trainingAssignment row.
--
-- The original SELECT policy (created in 20251205021915_training.sql) only
-- granted access to users with the people_view permission, so a regular
-- employee opening /share/training/:assignmentId from their assignment
-- notification was hidden from the row by RLS and the route returned a 404.
--
-- Add an assignee branch: any employee in the assignment's company whose
-- group membership intersects "groupIds" can read it. groupIds may contain
-- either real group ids or individual user ids; users have an identity group
-- with id = user.id (see create_user_identity_group), so groups_for_user
-- naturally covers the individual case.

ALTER POLICY "SELECT" ON "public"."trainingAssignment"
USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('people_view')
    )::text[]
  )
  OR (
    "companyId" = ANY (
      (
        SELECT
          get_companies_with_employee_role ()
      )::text[]
    )
    AND groups_for_user (auth.uid ()::text) && "groupIds"
  )
);
