-- Add DocuSign integration
INSERT INTO "integration" ("id", "title", "description", "logoPath", "jsonschema")
VALUES
  ('docusign', 'DocuSign', 'Request e-signatures on purchase order PDFs', '/integrations/docusign.png', '{"type": "object", "properties": {}, "required": []}'::json);
