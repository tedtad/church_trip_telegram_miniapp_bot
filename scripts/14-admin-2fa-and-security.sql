-- Admin 2FA + security hardening migration
-- Safe to run multiple times.

ALTER TABLE IF EXISTS public.app_settings
  ADD COLUMN IF NOT EXISTS two_factor_enabled boolean DEFAULT true;

UPDATE public.app_settings
SET two_factor_enabled = COALESCE(two_factor_enabled, true)
WHERE id = 'default';

ALTER TABLE IF EXISTS public.admin_users
  ADD COLUMN IF NOT EXISTS telegram_user_id bigint,
  ADD COLUMN IF NOT EXISTS two_factor_enabled boolean DEFAULT true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'telegram_users'
  ) THEN
    BEGIN
      ALTER TABLE public.admin_users
        ADD CONSTRAINT admin_users_telegram_user_id_fkey
        FOREIGN KEY (telegram_user_id)
        REFERENCES public.telegram_users(id)
        ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

UPDATE public.admin_users
SET two_factor_enabled = COALESCE(two_factor_enabled, true);

CREATE INDEX IF NOT EXISTS idx_admin_users_telegram_user_id ON public.admin_users(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_is_active_role ON public.admin_users(is_active, role);

CREATE TABLE IF NOT EXISTS public.admin_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  otp_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  requested_ip text,
  requested_user_agent text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_otp_challenges_admin_pending
  ON public.admin_otp_challenges(admin_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_otp_challenges_expires_at
  ON public.admin_otp_challenges(expires_at);

CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_created
  ON public.activity_logs(entity_type, created_at DESC);
