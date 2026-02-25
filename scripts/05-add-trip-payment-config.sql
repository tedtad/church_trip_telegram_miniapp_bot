-- Add manual payment configuration fields to trips.
-- Safe to run multiple times.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS bank_accounts JSONB,
  ADD COLUMN IF NOT EXISTS telebirr_manual_account_name TEXT,
  ADD COLUMN IF NOT EXISTS telebirr_manual_account_number TEXT,
  ADD COLUMN IF NOT EXISTS manual_payment_note TEXT;

UPDATE trips
SET bank_accounts = '[]'::jsonb
WHERE bank_accounts IS NULL;

