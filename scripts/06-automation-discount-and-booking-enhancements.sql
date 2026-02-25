-- Adds discount, booking profile, and Telegram channel automation fields.
-- Safe to run multiple times.

-- 0) Baseline table for app-level settings (may be missing in older databases)
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  app_name TEXT,
  app_description TEXT,
  app_color TEXT DEFAULT '#06b6d4',
  logo_url TEXT,
  logo_filename TEXT,
  receipt_cache_ttl INTEGER DEFAULT 3600,
  max_file_size INTEGER DEFAULT 10,
  supported_file_types TEXT[] DEFAULT ARRAY['image/jpeg', 'image/jpg', 'image/png', 'application/pdf', 'image/webp'],
  smtp_enabled BOOLEAN DEFAULT FALSE,
  sms_enabled BOOLEAN DEFAULT FALSE,
  telegram_notifications_enabled BOOLEAN DEFAULT TRUE,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  maintenance_mode BOOLEAN DEFAULT FALSE,
  maintenance_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1) Discount vouchers / invitation enhancements
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_uses INTEGER DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invitations'
      AND column_name = 'used_count'
  ) THEN
    EXECUTE '
      UPDATE invitations
      SET current_uses = COALESCE(current_uses, used_count, 0)
      WHERE current_uses IS NULL
    ';
  ELSE
    EXECUTE '
      UPDATE invitations
      SET current_uses = COALESCE(current_uses, 0)
      WHERE current_uses IS NULL
    ';
  END IF;
END $$;

-- 2) Booking session customer and discount pricing snapshot
ALTER TABLE telegram_booking_sessions
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS discount_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_voucher_id UUID;

-- 3) Receipt-level discount accounting
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS trip_id UUID,
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0;

-- 4) Trip telegram automation tracking
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS telegram_announced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_group_url TEXT,
  ADD COLUMN IF NOT EXISTS telegram_group_chat_id TEXT;

-- 5) App settings for channel posting automation
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS app_name TEXT,
  ADD COLUMN IF NOT EXISTS app_description TEXT,
  ADD COLUMN IF NOT EXISTS app_color TEXT DEFAULT '#06b6d4',
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS logo_filename TEXT,
  ADD COLUMN IF NOT EXISTS receipt_cache_ttl INTEGER DEFAULT 3600,
  ADD COLUMN IF NOT EXISTS max_file_size INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS supported_file_types TEXT[] DEFAULT ARRAY['image/jpeg', 'image/jpg', 'image/png', 'application/pdf', 'image/webp'],
  ADD COLUMN IF NOT EXISTS smtp_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS telegram_notifications_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS maintenance_message TEXT,
  ADD COLUMN IF NOT EXISTS telegram_channel_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_channel_url TEXT,
  ADD COLUMN IF NOT EXISTS telegram_channel_name TEXT,
  ADD COLUMN IF NOT EXISTS telegram_post_new_trip BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS telegram_post_weekly_summary BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS telegram_post_daily_countdown BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS telegram_recommendation_interval_hours INTEGER DEFAULT 24,
  ADD COLUMN IF NOT EXISTS telegram_last_recommendation_post_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_last_weekly_post_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_last_daily_post_date DATE;

INSERT INTO app_settings (id, app_name, app_description)
VALUES ('default', 'TicketHub', 'Telegram Ticket Reservation System')
ON CONFLICT (id) DO NOTHING;

-- 6) Performance indexes
CREATE INDEX IF NOT EXISTS idx_invitations_trip_active ON invitations (trip_id, is_active);
CREATE INDEX IF NOT EXISTS idx_receipts_trip_approval ON receipts (trip_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_booking_sessions_user_trip_status ON telegram_booking_sessions (telegram_user_id, trip_id, status);
CREATE INDEX IF NOT EXISTS idx_trips_departure_status ON trips (departure_date, status);

-- 7) Trip/campaign lifecycle summary tracking
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS telegram_final_summary_posted_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS charity_campaigns
  ADD COLUMN IF NOT EXISTS telegram_channel_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_channel_url TEXT,
  ADD COLUMN IF NOT EXISTS telegram_group_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_group_url TEXT,
  ADD COLUMN IF NOT EXISTS telegram_announced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_final_summary_posted_at TIMESTAMPTZ;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS charity_channel_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS charity_channel_url TEXT,
  ADD COLUMN IF NOT EXISTS charity_group_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS charity_group_url TEXT,
  ADD COLUMN IF NOT EXISTS charity_auto_post_new_campaign BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS charity_auto_post_summary BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS charity_last_summary_post_at TIMESTAMPTZ;
