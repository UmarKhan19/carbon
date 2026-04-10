-- Loosen the "resend" integration jsonschema so SMTP payloads are accepted.
-- Field-level validation now lives in the app action via the Zod
-- discriminatedUnion exported from @carbon/ee (same pattern used by the Jira
-- integration, see 20260215000000_add_jira_integration.sql).
--
-- Note: title/description/logoPath/visible were dropped from "integration" in
-- 20241006185904_integration-refactor.sql. The display name now lives entirely
-- in the integration config (packages/ee/src/resend/config.tsx).
UPDATE "integration"
SET "jsonschema" = '{"type": "object", "properties": {"provider": {"type": "string"}}, "required": ["provider"]}'::json
WHERE "id" = 'resend';

-- Backfill existing installs so they pass the new Zod discriminated union on
-- their next save. Legacy rows stored only apiKey + fromEmail — stamp them
-- with provider = "resend" so the trigger and the Inngest handler both
-- continue to work unchanged.
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
