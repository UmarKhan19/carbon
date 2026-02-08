-- Add ingot as a material shape
INSERT INTO "materialForm" ("id", "name", "code", "createdBy") VALUES
  ('ingot', 'Ingot', 'ING', 'system');

-- Add ingot dimensions (weight-based dimensions commonly used for casting ingots) - Imperial
INSERT INTO "materialDimension" ("id", "materialFormId", "name", "isMetric", "companyId") VALUES
  -- Small ingots (precious metals, specialty casting)
  ('ingot-1oz', 'ingot', '1 oz', false, null),
  ('ingot-2-5oz', 'ingot', '2.5 oz', false, null),
  ('ingot-5oz', 'ingot', '5 oz', false, null),
  ('ingot-10oz', 'ingot', '10 oz', false, null),
  ('ingot-1lb', 'ingot', '1 lb', false, null),
  ('ingot-2lb', 'ingot', '2 lb', false, null),
  ('ingot-5lb', 'ingot', '5 lb', false, null),
  ('ingot-10lb', 'ingot', '10 lb', false, null),
  ('ingot-20lb', 'ingot', '20 lb', false, null),
  ('ingot-25lb', 'ingot', '25 lb', false, null),
  ('ingot-50lb', 'ingot', '50 lb', false, null),
  ('ingot-100lb', 'ingot', '100 lb', false, null),
  ('ingot-250lb', 'ingot', '250 lb', false, null),
  ('ingot-500lb', 'ingot', '500 lb', false, null),
  ('ingot-1000lb', 'ingot', '1000 lb', false, null),
  
  -- Standard bars/ingots (troy ounces)
  ('ingot-100oz', 'ingot', '100 oz', false, null),
  ('ingot-400oz', 'ingot', '400 oz (Good Delivery)', false, null),
  
  -- Ingot dimensions (weight-based dimensions for casting ingots) - Metric
  ('ingot-0-5kg', 'ingot', '0.5 kg', true, null),
  ('ingot-1kg', 'ingot', '1 kg', true, null),
  ('ingot-2kg', 'ingot', '2 kg', true, null),
  ('ingot-5kg', 'ingot', '5 kg', true, null),
  ('ingot-9kg', 'ingot', '9 kg (20 lb equivalent)', true, null),
  ('ingot-10kg', 'ingot', '10 kg', true, null),
  ('ingot-12-4kg', 'ingot', '12.4 kg (400 oz Good Delivery)', true, null),
  ('ingot-20kg', 'ingot', '20 kg', true, null),
  ('ingot-25kg', 'ingot', '25 kg', true, null),
  ('ingot-50kg', 'ingot', '50 kg', true, null),
  ('ingot-100kg', 'ingot', '100 kg', true, null),
  ('ingot-250kg', 'ingot', '250 kg', true, null),
  ('ingot-500kg', 'ingot', '500 kg', true, null);
