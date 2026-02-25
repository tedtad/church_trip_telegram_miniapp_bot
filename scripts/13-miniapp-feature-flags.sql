-- Adds Mini App feature flags and maintenance/app name defaults when missing.
-- Safe to run multiple times.

DO $$
BEGIN
  IF to_regclass('public.app_settings') IS NULL THEN
    RAISE NOTICE 'app_settings table does not exist. Run base migrations first.';
    RETURN;
  END IF;
END $$;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS app_name text DEFAULT 'TicketHub',
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_message text,
  ADD COLUMN IF NOT EXISTS charity_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS discount_enabled boolean DEFAULT true;

UPDATE public.app_settings
SET
  app_name = COALESCE(NULLIF(TRIM(app_name), ''), 'TicketHub'),
  maintenance_mode = COALESCE(maintenance_mode, false),
  charity_enabled = COALESCE(charity_enabled, true),
  discount_enabled = COALESCE(discount_enabled, true)
WHERE id = 'default';

