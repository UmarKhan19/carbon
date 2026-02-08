-- Add ingot as a material shape
INSERT INTO "materialForm" ("id", "name", "code", "createdBy") VALUES
  ('ingot', 'Ingot', 'ING', 'system');

-- Add ingot dimensions (weight-based dimensions commonly used for ingots) - Imperial
INSERT INTO "materialDimension" ("id", "materialFormId", "name", "isMetric", "companyId") VALUES
  ('ingot-1', 'ingot', '1 lb', false, null),
  ('ingot-2', 'ingot', '2 lb', false, null),
  ('ingot-5', 'ingot', '5 lb', false, null),
  ('ingot-10', 'ingot', '10 lb', false, null),
  ('ingot-25', 'ingot', '25 lb', false, null),
  ('ingot-50', 'ingot', '50 lb', false, null),
  ('ingot-100', 'ingot', '100 lb', false, null),
  
  -- Ingot dimensions (weight-based dimensions for ingots) - Metric
  ('ingot-0-5kg', 'ingot', '0.5 kg', true, null),
  ('ingot-1kg', 'ingot', '1 kg', true, null),
  ('ingot-2kg', 'ingot', '2 kg', true, null),
  ('ingot-5kg', 'ingot', '5 kg', true, null),
  ('ingot-10kg', 'ingot', '10 kg', true, null),
  ('ingot-25kg', 'ingot', '25 kg', true, null),
  ('ingot-50kg', 'ingot', '50 kg', true, null);
