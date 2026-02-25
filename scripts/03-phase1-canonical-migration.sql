-- Phase 1 Canonical Migration
-- Run in Supabase SQL editor.

-- 1) Canonical trip status support (status + backward compatibility with trip_status)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS trip_status TEXT;

UPDATE trips
SET status = COALESCE(status, trip_status, 'active')
WHERE status IS NULL;

UPDATE trips
SET trip_status = COALESCE(trip_status, status, 'active')
WHERE trip_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_trips_status_canonical ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_trip_status_legacy ON trips(trip_status);

CREATE OR REPLACE FUNCTION sync_trips_status_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS NULL AND NEW.trip_status IS NOT NULL THEN
    NEW.status := NEW.trip_status;
  ELSIF NEW.trip_status IS NULL AND NEW.status IS NOT NULL THEN
    NEW.trip_status := NEW.status;
  ELSIF NEW.status IS NULL AND NEW.trip_status IS NULL THEN
    NEW.status := 'active';
    NEW.trip_status := 'active';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_trips_status_columns ON trips;
CREATE TRIGGER trg_sync_trips_status_columns
BEFORE INSERT OR UPDATE ON trips
FOR EACH ROW EXECUTE FUNCTION sync_trips_status_columns();

-- 2) Booking sessions for Telegram receipt flow
CREATE TABLE IF NOT EXISTS telegram_booking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL, -- bank | telebirr | telebirr_auto
  quantity INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'awaiting_receipt', -- awaiting_receipt | completed | cancelled
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_sessions_user_status
  ON telegram_booking_sessions(telegram_user_id, status);
CREATE INDEX IF NOT EXISTS idx_booking_sessions_trip
  ON telegram_booking_sessions(trip_id);

CREATE OR REPLACE FUNCTION update_telegram_booking_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_booking_sessions_updated_at ON telegram_booking_sessions;
CREATE TRIGGER trg_booking_sessions_updated_at
BEFORE UPDATE ON telegram_booking_sessions
FOR EACH ROW EXECUTE FUNCTION update_telegram_booking_sessions_updated_at();

ALTER TABLE telegram_booking_sessions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'telegram_booking_sessions'
      AND policyname = 'allow_all_read_booking_sessions'
  ) THEN
    CREATE POLICY "allow_all_read_booking_sessions"
      ON telegram_booking_sessions
      FOR SELECT
      USING (true);
  END IF;
END
$$;

GRANT ALL ON telegram_booking_sessions TO authenticated;

-- 3) Ensure receipt fields needed by Phase 1 are available
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS receipt_hash TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS approval_notes TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 4) Ensure tickets have QR + issued timestamp fields
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS qr_code TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issued_at TIMESTAMP WITH TIME ZONE;

-- 5) Allow telebirr_auto as payment method value
-- (No strict CHECK constraint enforced in current schema, so no constraint alteration needed.)

-- 6) Optional helper index for fast receipt lookup
CREATE INDEX IF NOT EXISTS idx_receipts_reference_phase1 ON receipts(reference_number);
