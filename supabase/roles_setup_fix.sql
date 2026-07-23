-- Idempotent roles setup/repair script for ticket role assignment.
-- Run this in Supabase SQL Editor when role assignment shows setup warnings.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure expected columns exist even if table was created from an older schema.
ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

INSERT INTO roles (name)
VALUES
  ('Chairman'),
  ('Legal'),
  ('Grounds'),
  ('Technology')
ON CONFLICT (name) DO NOTHING;

-- Make sure roles can be read/managed by authenticated users through PostgREST.
GRANT SELECT, INSERT, UPDATE ON TABLE public.roles TO authenticated;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view roles" ON roles;
CREATE POLICY "Authenticated users can view roles"
  ON roles FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert roles" ON roles;
CREATE POLICY "Authenticated users can insert roles"
  ON roles FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update roles" ON roles;
CREATE POLICY "Authenticated users can update roles"
  ON roles FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Ensure dependent role_id columns exist.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role_id UUID;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS role_id UUID;

-- Recreate role foreign keys if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_role_id_fkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_role_id_fkey
      FOREIGN KEY (role_id)
      REFERENCES roles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tickets_role_id_fkey'
      AND conrelid = 'public.tickets'::regclass
  ) THEN
    ALTER TABLE tickets
      ADD CONSTRAINT tickets_role_id_fkey
      FOREIGN KEY (role_id)
      REFERENCES roles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Quick verification output.
SELECT id, name, created_at
FROM roles
ORDER BY name;
