# Plan: Custom SMTP support for Email integration

## Steps
- [x] Extend `IntegrationSetting` type with `password` variant and `visibleWhen`
- [x] Rewrite `packages/ee/src/resend/config.tsx` into a generic Email integration (provider selector, Resend + SMTP groups, discriminatedUnion schema)
- [x] Teach `IntegrationForm.tsx` to render the password field and gate fields/groups by `visibleWhen`
- [x] Add `nodemailer` + `@types/nodemailer` to `packages/jobs`
- [x] Branch `send-email.ts` on `metadata.provider` (resend vs. smtp via dynamic `nodemailer` import)
- [x] Create migration `20260410040000_email-smtp-support.sql` loosening the `integration` jsonschema and backfilling `provider=resend`
- [x] Typecheck `@carbon/ee`, `@carbon/jobs`, and `erp` (all clean)

## Review

Changes land in six files plus one new migration. All three typechecks pass
(`@carbon/ee`, `@carbon/jobs`, `erp`). Backwards compatibility is preserved two
ways: (1) the integration id stays `resend`, so installed rows are untouched
by the UI change; (2) the Inngest handler defaults missing `metadata.provider`
to `"resend"` before parsing, and the migration stamps existing rows so they
pass the new discriminated-union schema on their next save. The DB-level
`verify_integration` trigger is loosened to a `{ provider: string }` shape
(same pattern as the Jira integration), and real validation happens at the
Zod layer in the app action.

### Files touched
- `packages/ee/src/types.ts`
- `packages/ee/src/resend/config.tsx`
- `apps/erp/app/modules/settings/ui/Integrations/IntegrationForm.tsx`
- `apps/erp/app/routes/x+/settings+/integrations.$id.tsx`
- `packages/jobs/package.json`
- `packages/jobs/src/inngest/functions/notifications/send-email.ts`
- `packages/database/supabase/migrations/20260410040000_email-smtp-support.sql`
