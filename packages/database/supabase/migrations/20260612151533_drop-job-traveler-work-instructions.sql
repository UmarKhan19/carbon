-- "Include work instructions" is now a Job Traveler template option (operations
-- block "Show work instructions"). Before dropping the company flag, bake the
-- preference of companies that had it ON into their jobTraveler template's
-- operations block so their travelers keep printing work instructions.
-- (Companies with no stored template fall back to the template default of OFF,
-- matching the old column default of false.)
UPDATE "documentTemplate" dt
SET blocks = (
  SELECT jsonb_agg(
    CASE
      WHEN block->>'type' = 'operations'
        THEN block || '{"showWorkInstructions": true}'::jsonb
      ELSE block
    END
  )
  FROM jsonb_array_elements(dt.blocks) AS block
)
FROM "companySettings" cs
WHERE cs.id = dt."companyId"
  AND dt."documentType" = 'jobTraveler'
  AND cs."jobTravelerIncludeWorkInstructions" = true
  AND dt.blocks @> '[{"type":"operations"}]';

ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "jobTravelerIncludeWorkInstructions";
