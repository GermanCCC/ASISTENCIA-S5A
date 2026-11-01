-- Sustitutos locales de los esquemas administrados por Supabase.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS local;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}', raw_user_meta_data jsonb NOT NULL DEFAULT '{}',
  password_hash text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE local.sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '180 days'
);
CREATE TABLE local.settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets,
  name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA local, auth, storage FROM PUBLIC;
REVOKE ALL ON auth.users, local.sessions, local.settings FROM PUBLIC, anon, authenticated;
