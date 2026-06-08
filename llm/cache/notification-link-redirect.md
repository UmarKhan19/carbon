# Notification Link & Company-Aware Redirect

How notification emails / Slack DMs deep-link recipients into the right document,
switching them into the document's company when needed.

## Flow

1. **Build link** — `packages/jobs/src/inngest/functions/notifications/notify.ts`
   - `buildNotificationLink(event, documentId, companyId, documentType?)` builds
     `${ERP_URL}/api/link?event=...&documentId=...&companyId=...[&documentType=...]`.
   - Called twice in `notify.ts`: once for the email fan-out and once for the
     Slack DM fan-out. Both pass `payload.companyId` (the company that owns the
     document/notification).
   - Email template: `packages/documents/src/email/NotificationEmail.tsx`
     (`ctaUrl` button + plaintext fallback).

2. **Resolve + maybe switch company** — `apps/erp/app/routes/api+/link.ts`
   (loader; requires auth via `requirePermissions(request, {})`).
   - `resolve(event, documentId, documentType?)` maps a `NotificationEvent` to an
     in-app path (e.g. `JobAssignment -> path.to.job(id)`).
   - Reads `companyId` query param. If present and != the session's current
     `companyId`, it loads `getCompanies(client, userId)` and, if the user belongs
     to that company, switches them into it **before** redirecting — mirroring the
     company switcher — by setting two cookies on the redirect response:
     - `updateCompanySession(request, companyId, companyGroupId)` (session cookie,
       clears the user's permission cache in redis)
     - `setCompanyId(companyId)` (the `companyId` cookie)
   - If `companyId` matches or the user doesn't belong to it, redirects normally.

## Company switcher (the canonical pattern this mirrors)

- Action: `apps/erp/app/routes/x+/settings+/company.switch.$companyId.tsx`
  validates the target company is in `getCompanies(client, userId)`, then sets the
  same two cookies.
- Cookie helpers: `packages/auth/src/services/company.server.ts`
  (`getCompanyId` / `setCompanyId`, cookie name `companyId`, 1-year max age).
- Session update: `updateCompanySession` in
  `packages/auth/src/services/session.server.ts`.
- `requirePermissions` returns the session `companyId` (from the auth session),
  so the link loader compares against that to decide whether to switch.
