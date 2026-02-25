-- Adds discount, booking profile, and Telegram channel automation fields.
-- Safe to run multiple times.

-- 1) Discount vouchers / invitation enhancements
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_uses INTEGER DEFAULT 0;

UPDATE invitations
SET current_uses = COALESCE(current_uses, used_count, 0)
WHERE current_uses IS NULL;

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
