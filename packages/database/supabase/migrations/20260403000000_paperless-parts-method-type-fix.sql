UPDATE "companyIntegration"
SET "metadata" = ("metadata"::jsonb || '{"methodType": "Purchase to Order"}'::jsonb)::json
WHERE "id" = 'paperless-parts'
  AND "metadata"::jsonb->>'methodType' = 'Buy';

UPDATE "companyIntegration"
SET "metadata" = ("metadata"::jsonb || '{"methodType": "Pull from Inventory"}'::jsonb)::json
WHERE "id" = 'paperless-parts'
  AND "metadata"::jsonb->>'methodType' = 'Pick';
