-- Admin user onboarding and account lock policy hardening.
-- Safe to run multiple times.

ALTER TABLE IF EXISTS public.admin_users
  ADD COLUMN IF NOT EXISTS phone_number text;

CREATE INDEX IF NOT EXISTS idx_admin_users_phone_number ON public.admin_users(phone_number);

CREATE TABLE IF NOT EXISTS public.admin_user_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  email text NOT NULL,
  phone_number text,
  onboarding_token text NOT NULL UNIQUE,
  otp_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  telegram_user_id bigint,
  username text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  locked_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'telegram_users'
  ) THEN
    BEGIN
      ALTER TABLE public.admin_user_onboarding
        ADD CONSTRAINT admin_user_onboarding_telegram_user_id_fkey
        FOREIGN KEY (telegram_user_id)
        REFERENCES public.telegram_users(id)
        ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_admin_user_onboarding_admin ON public.admin_user_onboarding(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_user_onboarding_token ON public.admin_user_onboarding(onboarding_token);
CREATE INDEX IF NOT EXISTS idx_admin_user_onboarding_status ON public.admin_user_onboarding(status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_user_onboarding_telegram ON public.admin_user_onboarding(telegram_user_id, status, expires_at DESC);

ALTER TABLE IF EXISTS public.admin_otp_challenges
  ALTER COLUMN max_attempts SET DEFAULT 3;

UPDATE public.admin_otp_challenges
SET max_attempts = 3
WHERE COALESCE(max_attempts, 0) <> 3;
