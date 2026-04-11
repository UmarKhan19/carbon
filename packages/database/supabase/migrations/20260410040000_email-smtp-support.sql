-- Generalize the legacy "resend" integration into a generic "email" integration
-- that supports both Resend and Custom SMTP delivery methods.
--
-- 1. Rename the integration row from "resend" to "email". The companyIntegration
--    foreign key uses ON UPDATE CASCADE (see 20240119095150_integrations.sql),
--    so this propagates to existing installs automatically.
-- 2. Loosen the jsonschema so SMTP payloads are accepted. Field-level validation
--    now lives in the app action via the Zod discriminatedUnion exported from
--    @carbon/ee (same pattern used by the Jira integration, see
--    20260215000000_add_jira_integration.sql).
-- 3. Backfill existing installs so they pass the new Zod discriminated union on
--    their next save. Legacy rows stored only apiKey + fromEmail — stamp them
--    with provider = "resend" so the trigger and the Inngest handler both
--    continue to work unchanged.
--
-- Note: title/description/logoPath/visible were dropped from "integration" in
-- 20241006185904_integration-refactor.sql. The display name now lives entirely
-- in the integration config (packages/ee/src/email/config.tsx).

UPDATE "integration"
SET "id" = 'email',
    "jsonschema" = '{"type": "object", "properties": {"provider": {"type": "string"}}, "required": ["provider"]}'::json
WHERE "id" = 'resend';

UPDATE "companyIntegration"
SET "metadata" =
  jsonb_set(
    "metadata"::jsonb,
    '{provider}',
    '"resend"'::jsonb,
    true
  )::json
WHERE "id" = 'email'
  AND ("metadata"->>'provider') IS NULL;
