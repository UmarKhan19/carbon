-- Local dev seed: creates a test user so you can sign in without Resend/Redis
-- This runs automatically after `supabase db reset`

-- 1. Create auth user (password: "password123")
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token
) VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'chase.t.foster@gmail.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"firstName":"Chase","lastName":"Foster"}',
  now(),
  now(),
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- 2. Create identity for the auth user
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  jsonb_build_object('sub', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'email', 'chase.t.foster@gmail.com'),
  'email',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  now(),
  now(),
  now()
) ON CONFLICT DO NOTHING;

-- 3. Create app user record (so login treats you as existing user → magic link flow)
INSERT INTO public."user" (id, email, "firstName", "lastName", active)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'chase.t.foster@gmail.com',
  'Chase',
  'Foster',
  true
) ON CONFLICT (id) DO NOTHING;
