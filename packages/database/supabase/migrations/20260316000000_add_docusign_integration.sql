-- DocuSign eSignature Integration
--
-- Registers DocuSign as an available integration. OAuth credentials are stored
-- in companyIntegration.metadata.credentials (access token, refresh token,
-- account ID, base URI).
--
-- Envelope-to-PO mappings use the existing externalIntegrationMapping table:
--   entityType  = 'purchaseOrder'
--   integration = 'docusign'
--   externalId  = DocuSign envelope ID
--   metadata    = { envelopeId, status, signerName, signerEmail, subject, sentAt }
--
-- Existing indexes already cover the DocuSign query patterns:
--   externalIntegrationMapping_lookup_idx  (integration, externalId, companyId)
--     -> fast webhook lookups by envelope ID
--   externalIntegrationMapping_entityType_entityId_integration_companyId_key (unique)
--     -> one envelope per PO per company
--
-- No new tables, columns, or indexes are required.

INSERT INTO "integration" ("id", "jsonschema")
VALUES
  ('docusign', '{"type": "object", "properties": {}}'::json);
