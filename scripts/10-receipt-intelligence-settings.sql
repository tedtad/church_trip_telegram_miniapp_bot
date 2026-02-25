-- Receipt intelligence settings + optional sample collection
-- Safe and idempotent migration

ALTER TABLE app_settings
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
