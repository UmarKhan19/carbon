-- Generalize the legacy "resend" integration into a generic "email" integration
-- that supports both Resend and Custom SMTP delivery methods.
--
-- Execution order matters: companyIntegration.id has ON UPDATE CASCADE against
-- integration.id (see 20240119095150_integrations.sql), and the
-- sync_verify_integration BEFORE trigger
-- (20260410031811_remaining-interceptors.sql) re-validates metadata against
-- whatever jsonschema the integration currently has. If we rename + tighten
-- the schema first, the cascaded UPDATE on companyIntegration fails for
-- active installs whose legacy metadata lacks `provider`. So we:
--   1. Backfill provider='resend' on existing rows (passes the OLD schema).
--   2. Rename integration id to 'email' and swap in the new schema.
--
-- Field-level validation for SMTP vs. Resend now lives in the app action via
-- the Zod discriminatedUnion exported from @carbon/ee (same pattern as the
-- Jira integration, see 20260215000000_add_jira_integration.sql).
--
-- Note: title/description/logoPath/visible were dropped from "integration" in
-- 20241006185904_integration-refactor.sql. The display name now lives entirely
-- in the integration config (packages/ee/src/email/config.tsx).

-- 1. Backfill provider on existing installs while id is still 'resend'.
UPDATE "companyIntegration"
SET "metadata" =
  jsonb_set(
    "metadata"::jsonb,
    '{provider}',
    '"resend"'::jsonb,
    true
  )::json
WHERE "id" = 'resend'
  AND ("metadata"->>'provider') IS NULL;

-- 2. Rename integration row from 'resend' to 'email' and loosen the schema.
--    ON UPDATE CASCADE propagates the id to companyIntegration; the trigger
--    re-validates and now passes because provider is present.
UPDATE "integration"
SET "id" = 'email',
    "jsonschema" = '{"type": "object", "properties": {"provider": {"type": "string"}}, "required": ["provider"]}'::json
WHERE "id" = 'resend';
