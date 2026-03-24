-- Console mode: allow creating lightweight "console operators" who can pin in at
-- shared MES terminals without needing email, password, or Supabase Auth accounts.
ALTER TABLE "user" ADD COLUMN "isConsoleOperator" BOOLEAN NOT NULL DEFAULT false;

-- PIN for console mode authentication (4-digit numeric code).
-- Stored on employee (per-company) so the same user could have different PINs
-- at different companies. NULL means no PIN set (PIN entry is skipped).
ALTER TABLE "employee" ADD COLUMN "pin" TEXT;

-- Whether PIN is required for console mode pin-in.
-- When true, operators MUST have a PIN set and enter it to pin in.
-- Default true — PINs are required for accountability.
ALTER TABLE "companySettings" ADD COLUMN "consolePinRequired" BOOLEAN NOT NULL DEFAULT true;

-- Create "Console Operator" employee type for all existing companies.
-- Same pattern as "Admin" type: protected so it can't be accidentally deleted.
-- Only insert if it doesn't already exist for that company.
INSERT INTO "employeeType" (name, "companyId", protected)
SELECT 'Console Operator', c.id, true
FROM "company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "employeeType" et
  WHERE et.name = 'Console Operator' AND et."companyId" = c.id
);

-- Update the auth trigger to handle converting console operators to full users.
-- When a console operator is converted, an auth.users entry is created with the same ID
-- as the existing public.user record. The trigger must not fail on the duplicate.
CREATE OR REPLACE FUNCTION public.create_public_user()
RETURNS TRIGGER AS $$
DECLARE
  full_name TEXT;
  name_parts TEXT[];
  existing_user RECORD;
BEGIN
  -- Check if user already exists (e.g., console operator being converted)
  SELECT * INTO existing_user FROM public."user" WHERE id = NEW.id;
  IF FOUND THEN
    -- User already exists, just update email and ensure userPermission exists
    UPDATE public."user" SET email = NEW.email WHERE id = NEW.id;
    INSERT INTO public."userPermission" (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Get the full name from raw_user_metadata if it exists
  full_name := NEW.raw_user_meta_data->>'name';

  -- Split name into parts if we have a full name
  IF full_name IS NOT NULL THEN
    name_parts := regexp_split_to_array(full_name, '\s+');
    INSERT INTO public."user" ("id", "email", "active", "firstName", "lastName", "about")
    VALUES (
      NEW.id,
      NEW.email,
      true,
      COALESCE(name_parts[1], ''),
      COALESCE(array_to_string(name_parts[2:], ' '), ''),
      ''
    );
  ELSE
    INSERT INTO public."user" ("id", "email", "active", "firstName", "lastName", "about")
    VALUES (
      NEW.id,
      NEW.email,
      true,
      '',
      '',
      ''
    );
  END IF;

  INSERT INTO public."userPermission" (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
