# Bug: Assigned users cannot take training test

Note: Spawn subtasks to query the cache folder any time I need to learn something
about the codebase. NEVER update the cache with plans or information about code
that is not yet committed.

## Symptom
A user assigned to a training opens `/share/training/:assignmentId` (the link from
their TrainingAssignment notification / `path.to.completeTrainingAssignment`) and
is greeted by `Training assignment not found` (404) instead of the test wizard.

## Root cause
`apps/erp/app/routes/share+/training.$id.tsx` calls
`getTrainingAssignmentForCompletion(client, id)` using the user's authenticated
Supabase client, so the query is subject to RLS. The SELECT policy on
`trainingAssignment` (defined in
`packages/database/supabase/migrations/20251205021915_training.sql:116-124`) is
gated on `get_companies_with_employee_permission('people_view')` — i.e. only HR
admins. Regular employees, including the very people the assignment was created
for, get zero rows back and the loader throws 404.

The downstream tables already accommodate the assignee:

- `training` SELECT — open to any employee in the company.
- `trainingQuestion` SELECT — open to any employee in the company.
- `trainingCompletion` INSERT — has the `auth.uid()::text = "employeeId"` clause.

Only `trainingAssignment` SELECT is too tight.

## Fix
Add a migration that loosens `trainingAssignment`'s SELECT policy to also allow
employees whose group membership intersects the assignment's `groupIds`.

`groupIds` may store either real group IDs or individual user IDs (each user gets
an identity group via `create_user_identity_group()` whose `id = userId`), so
`groups_for_user(auth.uid()::text) && "groupIds"` handles both.

Because the loader already guards `role: "employee"`, this also implicitly fixes
the converse authorization concern: non-assigned employees still won't be able to
read the row through RLS, so the loader's 404 path stays correct for them.

## Plan
- [x] Confirm RLS is the blocker (verified via the SELECT policy + service call).
- [x] Confirm `groups_for_user` semantics include identity groups so individually
      assigned users still match.
- [ ] Write migration `20260501XXXXXX_training-assignment-assignee-read.sql` that
      `ALTER POLICY "SELECT" ON "public"."trainingAssignment"` to add the
      assignee branch (preserve the existing `people_view` branch so HR keeps
      access).
- [ ] Re-read `share+/training.$id.tsx` to confirm no other RLS-gated reads block
      assignees.
- [ ] Commit + push to `claude/relaxed-wozniak-pTTrv`.

## Out of scope (noted, not changed)
- `20251211012654_training-to-resources.sql` migrated `training` and
  `trainingCompletion` policies from `people_*` to `resources_*` but missed
  `trainingAssignment`. Leaving that alignment alone — the bug fix is independent
  and the existing `people_view` clause still works for HR.
- The route loader doesn't post-validate group membership beyond the RLS check.
  With this RLS change the only way for an employee to load an assignment is to
  actually be assigned to it, which is sufficient.

## Review

(To be filled in after the migration lands.)
