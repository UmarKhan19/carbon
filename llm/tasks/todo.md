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
- [x] Write migration `20260501100000_training-assignment-assignee-read.sql` that
      `ALTER POLICY "SELECT" ON "public"."trainingAssignment"` to add the
      assignee branch (preserve the existing `people_view` branch so HR keeps
      access).
- [x] Re-read `share+/training.$id.tsx` to confirm no other RLS-gated reads block
      assignees (`training` and `trainingQuestion` SELECT are open to any
      employee; `trainingCompletion` INSERT already has the
      `auth.uid()::text = "employeeId"` clause).
- [x] Commit + push to `claude/relaxed-wozniak-pTTrv`.

## Out of scope (noted, not changed)
- `20251211012654_training-to-resources.sql` migrated `training` and
  `trainingCompletion` policies from `people_*` to `resources_*` but missed
  `trainingAssignment`. Leaving that alignment alone — the bug fix is independent
  and the existing `people_view` clause still works for HR.
- The route loader doesn't post-validate group membership beyond the RLS check.
  With this RLS change the only way for an employee to load an assignment is to
  actually be assigned to it, which is sufficient.

## Review

What landed: a single-statement RLS migration
(`20260501100000_training-assignment-assignee-read.sql`) that adds an OR branch
to the existing `trainingAssignment` SELECT policy. The new branch matches when
the caller is an employee in the assignment's company AND
`groups_for_user(auth.uid()::text) && "groupIds"`. The original `people_view`
branch is preserved verbatim, so HR's reporting view (the one that calls
`get_training_assignment_status` etc.) is unaffected.

Why this is the right fix instead of touching the route loader:

- The breakage is purely an RLS gap: `requirePermissions(role: "employee")`
  already lets the assignee through, the test page knows what to do, and
  `trainingCompletion` already lets them write a completion. Only the assignment
  read was tight.
- Loosening at the policy layer instead of bypassing RLS in the loader keeps
  data access governed by Postgres rather than by app code, which matches how
  every other assignee-read flow in this repo is modelled (see the
  `trainingCompletion` INSERT with the `auth.uid()::text = "employeeId"`
  branch).
- It also closes the converse concern flagged during exploration — that the
  loader had no extra group check beyond the role gate. With this policy,
  non-assigned employees can't read the row at all, so the loader's existing
  404 path stays correct without any app-side change.

What I did not change:

- `20251211012654_training-to-resources.sql` migrated `training` and
  `trainingCompletion` policies from `people_*` to `resources_*` but left
  `trainingAssignment` on `people_view`. That inconsistency is pre-existing and
  unrelated to this bug; folding a `people_*` → `resources_*` rename into a
  user-blocking fix would expand scope and risk regressions in HR's existing
  flow. Worth a separate cleanup ticket.
- The `share+/training.$id.tsx` loader/action are untouched.

Verification path I'd run before declaring this fully shipped (the user runs
migrations, not me):

1. Apply the migration to a dev DB.
2. As a non-HR employee assigned to a training (group OR direct user-id), open
   `/share/training/<assignmentId>` — should now load the wizard.
3. As an employee NOT in any of the assignment's groups, hit the same URL —
   should still 404 (because RLS hides the row).
4. As an HR user with `people_view` but NOT in the groups, hit the same URL —
   should still load (the original branch still grants).
5. Submit a passing run as the assignee — `trainingCompletion` row should
   insert and the existing assignment status query should reflect it.

Files touched:
- `packages/database/supabase/migrations/20260501100000_training-assignment-assignee-read.sql` (new)
