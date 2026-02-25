-- Receipt intelligence settings + optional sample collection
-- Safe and idempotent migration

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
  ADD COLUMN IF NOT EXISTS receipt_intelligence_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS receipt_sample_collection_enabled BOOLEAN DEFAULT FALSE;

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS receipt_provider TEXT,
  ADD COLUMN IF NOT EXISTS receipt_validation_mode TEXT,
  ADD COLUMN IF NOT EXISTS receipt_validation_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS receipt_validation_flags JSONB;

CREATE TABLE IF NOT EXISTS receipt_intelligence_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL DEFAULT 'miniapp_manual',
  payment_method TEXT,
  provider TEXT,
  receipt_link TEXT,
  reference_input TEXT,
  extracted_reference TEXT,
  amount_input NUMERIC(12,2),
  extracted_amount NUMERIC(12,2),
  receipt_date_input DATE,
  extracted_date DATE,
  validation_mode TEXT,
  validation_score NUMERIC(5,2),
  validation_flags JSONB,
  verdict TEXT NOT NULL DEFAULT 'pending',
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_samples_created ON receipt_intelligence_samples (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_samples_provider ON receipt_intelligence_samples (provider);
CREATE INDEX IF NOT EXISTS idx_receipt_samples_reference ON receipt_intelligence_samples (extracted_reference);
