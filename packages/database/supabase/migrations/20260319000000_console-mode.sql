-- Console mode: allow creating lightweight "console operators" who can pin in at
-- shared MES terminals without needing email, password, or Supabase Auth accounts.
ALTER TABLE "user" ADD COLUMN "isConsoleOperator" BOOLEAN NOT NULL DEFAULT false;

-- PIN for console mode authentication (4-digit numeric code).
-- Stored on employee (per-company) so the same user could have different PINs
-- at different companies. NULL means no PIN set.
ALTER TABLE "employee" ADD COLUMN "pin" TEXT;

-- Feature toggle: enable console mode for this company.
-- When enabled, the "Console Operator" employee type is created,
-- the Operators submodule appears in ERP, and the
-- Console Mode toggle appears in MES.
ALTER TABLE "companySettings" ADD COLUMN "consoleEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Update the auth trigger to use ON CONFLICT for the user insert.
-- This handles converting console operators (who already have a public.user record)
-- to full users (which creates an auth.users entry that fires this trigger).
CREATE OR REPLACE FUNCTION public.create_public_user()
RETURNS TRIGGER AS $$
DECLARE
  full_name TEXT;
  name_parts TEXT[];
BEGIN
  full_name := NEW.raw_user_meta_data->>'name';

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
    )
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  ELSE
    INSERT INTO public."user" ("id", "email", "active", "firstName", "lastName", "about")
    VALUES (
      NEW.id,
      NEW.email,
      true,
      '',
      '',
      ''
    )
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  END IF;

  INSERT INTO public."userPermission" (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
