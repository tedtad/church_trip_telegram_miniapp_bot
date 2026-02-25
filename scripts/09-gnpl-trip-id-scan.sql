-- GNPL trip-level enablement + ID-scan based identity evidence
-- Safe and idempotent migration

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS allow_gnpl BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE gnpl_accounts
  ALTER COLUMN id_number DROP NOT NULL;

ALTER TABLE gnpl_accounts
  ADD COLUMN IF NOT EXISTS id_card_file_url TEXT,
  ADD COLUMN IF NOT EXISTS id_card_file_name TEXT,
  ADD COLUMN IF NOT EXISTS id_card_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS id_card_uploaded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trips_allow_gnpl ON trips (allow_gnpl);
