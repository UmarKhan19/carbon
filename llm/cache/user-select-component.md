# UserSelect Component (employee/user/group selector)

The shared tree selector for picking users and/or groups. Located at
`apps/erp/app/components/Selectors/UserSelect/`:
- `UserSelect.tsx` — component shell
- `useUserSelect.ts` — all logic/state (the hook)
- `components/TreeSelect.tsx` — renders the group tree + options
- `provider.ts`, `types.ts`, `index.ts`

## Form wrappers
- `apps/erp/app/components/Form/Users.tsx` — `<Users>`: multi-select, users AND
  groups. `verbose` prop prepends `user_`/`group_` to emitted values.
- `apps/erp/app/components/Form/Employees.tsx` — `<Employees>`: passes
  `usersOnly` + `type="employee"`, multi-select (employees only, no group rows).
- `apps/erp/app/components/Form/Employee.tsx` — `<Employee>`: single-select; uses
  `@carbon/form` Combobox, NOT UserSelect.

## Async group-member architecture (commit 59831a2ac / PR #866)
Members are loaded LAZILY. The groups API returns metadata only by default.

API routes (`apps/erp/app/routes/api+/`):
- `users.groups.tsx` — group metadata; `?include=users` makes it also return the
  `users` array (eager). `?type=employee|customer|supplier` filters group kind.
- `users.groups.$groupId.members.tsx` — lazy-load one group's `users` array.
- `users.search.tsx` — server-side user search (`?q=`, `&excludeSelf`, `&allowedIds`).
- `users.batch.tsx` — resolve preselected user ids (`?ids=a,b,c`).

Path helpers in `apps/erp/app/utils/path.ts`: `groupsByType`,
`groupsByTypeWithUsers`, `groupMembers`, `usersSearch`, `usersBatch`.

## Data flow in useUserSelect.ts
- `groupsFetcher` loads `groupsByType(type)` (metadata only, no members).
- `arrayToTree` (server) nests groups by `parentId`.
- `optionGroups` memo builds the option tree; per group it takes members from
  `fetchedMembers[group.id] || group.data.users || []`. `fetchedMembers` is in
  its dependency array.
- `prefetchGroup(uid)` fires on group expand/hover → fetches `groupMembers` →
  `setFetchedMembers`. `uid` format is `${instanceId}_${groupId}_group`; group id
  is extracted via `uid.split("_")[1]` (useId() uses `:` not `_`, so this is safe).
- Typing ≥2 chars → debounced `usersSearch`, results cached in `searchCache`.
- Preselected values not present in the tree are resolved via `usersBatch`.
- `filteredOptionGroups` is what renders; a `useEffect` syncs it from
  `optionGroups` and applies the search filter.

## Consumers (grep `<Users`/`<Employees`/`<UserSelect`)
Training assignment (`type="employee"`), approval rules, document permissions,
group membership form (`verbose`), notification settings, bulk edit permissions
(`<Employees>`), approval rule details (read-only `<UserSelect>`).

EmailRecipients (`apps/erp/app/components/Form/EmailRecipients.tsx`) uses
`groupsByTypeWithUsers` because it renders a flat recipient list with no tree to
expand, so it needs members eagerly.
