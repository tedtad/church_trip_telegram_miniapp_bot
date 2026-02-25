-- RBAC + transfer + reconciliation supporting schema (safe, idempotent)

-- Admin roles are text-based; keep values open but normalize in app layer.
ALTER TABLE admin_users
  ALTER COLUMN role SET DEFAULT 'admin';

-- Ticket transfer tracking (optional columns used with graceful app fallback).
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transferred_to_phone TEXT,
  ADD COLUMN IF NOT EXISTS transferred_to_user_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_tickets_transferred_at ON tickets(transferred_at);
CREATE INDEX IF NOT EXISTS idx_tickets_transferred_to_user_id ON tickets(transferred_to_user_id);

-- Receipt parsing metadata (optional; app can run without these columns).
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS receipt_link TEXT,
  ADD COLUMN IF NOT EXISTS receipt_date DATE,
  ADD COLUMN IF NOT EXISTS parsed_reference_number TEXT,
  ADD COLUMN IF NOT EXISTS parsed_amount NUMERIC(12,2);

CREATE INDEX IF NOT EXISTS idx_receipts_receipt_date ON receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_receipts_parsed_reference_number ON receipts(parsed_reference_number);

-- Admin-side explicit transfer history table for auditing/reporting.
CREATE TABLE IF NOT EXISTS ticket_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  target_ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  source_user_id BIGINT NOT NULL,
  target_user_id BIGINT NOT NULL,
  target_phone TEXT,
  transfer_reference TEXT,
  transferred_by BIGINT,
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_ticket_transfers_source_ticket ON ticket_transfers(source_ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_target_ticket ON ticket_transfers(target_ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_transferred_at ON ticket_transfers(transferred_at DESC);
