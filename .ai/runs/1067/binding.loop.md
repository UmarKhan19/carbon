---
id: "1067"
kind: feature
risk: low
issue: 1067
title: "Send enrollment notification email to active Admins when a customer is enrolled in the Implementation Hub"
acceptance:
  - "A new React Email component ImplementationHubEmail exists at packages/documents/src/email/ImplementationHubEmail.tsx with props { recipientName?: string; hubUrl: string }, eyebrow 'Implementation Hub', heading 'Your implementation hub is ready', CTA button 'Open Implementation Hub' linking to hubUrl, fallback plain-text link, EmailThemeProvider + Logo + same CSS class names from NotificationEmail.tsx, and dark-mode @media blocks"
  - "ImplementationHubEmail is exported from packages/documents/src/email/index.ts"
  - "In apps/erp/app/routes/x+/get-started+/enroll.tsx, after successful enrollImplementation() (no result.error), active Admins for the enrolled companyId are queried via serviceRole"
  - "For each matching admin, a send-email Inngest job is triggered fire-and-forget (inside try/catch, per recipient) using renderAsync to render html and text, subject 'Your Implementation Hub is ready', with companyId"
  - "Enrollment never fails due to email errors: the admin-query + send block is fully wrapped in try/catch with console.error; catch never re-throws"
  - "No email is sent when result.error is truthy (enrollment failed)"
  - "pnpm --filter @carbon/documents typecheck passes (no new TypeScript errors)"
  - "pnpm --filter erp typecheck passes (no new TypeScript errors in enroll.tsx)"
  - "pnpm --filter @carbon/documents lint and pnpm --filter erp lint pass (no new Biome errors)"
---

# Send enrollment notification email to active Admins when a customer is enrolled in the Implementation Hub

## Goal

When `enrollImplementation()` succeeds in `apps/erp/app/routes/x+/get-started+/enroll.tsx`, send a notification email to every active Admin in the enrolled company. One email per recipient, fire-and-forget (enrollment must never fail due to email errors).

## Files to Change

| File | Action |
|---|---|
| `packages/documents/src/email/ImplementationHubEmail.tsx` | Create — new email template |
| `packages/documents/src/email/index.ts` | Add import + export for `ImplementationHubEmail` |
| `apps/erp/app/routes/x+/get-started+/enroll.tsx` | After successful enrollment: query admins, trigger emails |

## Notes

- `employeeType.systemType` enum value is `"Admin"` (from `Database["public"]["Enums"]["employeeTypeSystemType"]`)
- `serviceRole` is already in scope in `enroll.tsx` action (`getCarbonServiceRole()`)
- `path.to.getStarted` is already imported in `enroll.tsx` (used for the `redirect`)
- Use `ERP_URL` from `@carbon/env` for the base URL
- Copy the full CSS block (including dark-mode `@media` rules) from `NotificationEmail.tsx` verbatim
- The `employee.id` == `user.id` (same UUID, FK to auth) so the join is `user!inner(...)`
- Use `renderAsync` (not `render`) — matches existing `purchase-order` email pattern
- Query pattern for admins:
  ```ts
  serviceRole
    .from("employee")
    .select("id, active, employeeType!inner(systemType), user!inner(email, fullName)")
    .eq("companyId", companyId)
    .eq("active", true)
    .eq("employeeType.systemType", "Admin")
  ```
- Trigger pattern per recipient:
  ```ts
  const hubUrl = `${ERP_URL}${path.to.getStarted}`;
  const emailTemplate = ImplementationHubEmail({ recipientName: u.fullName ?? undefined, hubUrl });
  const html = await renderAsync(emailTemplate);
  const text = await renderAsync(emailTemplate, { plainText: true });
  await trigger("send-email", { to: [u.email], subject: "Your Implementation Hub is ready", html, text, companyId });
  ```
- Behavior proof (email actually sends) is unverified — human verification against a staging enrollment
- This is a low-risk additive feature: new file + 2 small edits to existing files
- No migration needed; no new DB schema changes
