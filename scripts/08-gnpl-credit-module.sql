-- GNPL (Go Now, Pay Later) schema additions
-- Safe and idempotent migration

-- 1) App-level GNPL configuration
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS gnpl_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gnpl_require_admin_approval BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS gnpl_default_term_days INTEGER DEFAULT 14,
  ADD COLUMN IF NOT EXISTS gnpl_penalty_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS gnpl_penalty_percent NUMERIC(5,2) DEFAULT 5,
  ADD COLUMN IF NOT EXISTS gnpl_penalty_period_days INTEGER DEFAULT 7,
  ADD COLUMN IF NOT EXISTS gnpl_reminder_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS gnpl_reminder_days_before INTEGER DEFAULT 0;

INSERT INTO app_settings (id, app_name, app_description)
VALUES ('default', 'TicketHub', 'Telegram Ticket Reservation System')
ON CONFLICT (id) DO NOTHING;

-- 2) GNPL account/application records
CREATE TABLE IF NOT EXISTS gnpl_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  booking_session_id UUID NULL REFERENCES telegram_booking_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  customer_name TEXT,
  customer_phone TEXT,
  id_number TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  base_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  approved_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  principal_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  penalty_accrued NUMERIC(12,2) NOT NULL DEFAULT 0,
  penalty_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  outstanding_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  penalty_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  penalty_period_days INTEGER NOT NULL DEFAULT 7,
  due_date DATE,
  next_penalty_at TIMESTAMPTZ,
  reminder_last_sent_on DATE,
  approved_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) GNPL repayment submissions
CREATE TABLE IF NOT EXISTS gnpl_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gnpl_account_id UUID NOT NULL REFERENCES gnpl_accounts(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  principal_component NUMERIC(12,2) NOT NULL DEFAULT 0,
  penalty_component NUMERIC(12,2) NOT NULL DEFAULT 0,
  unapplied_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_reference TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'manual',
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_file_url TEXT,
  receipt_file_name TEXT,
  receipt_link TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_by_user_id BIGINT,
  approved_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_gnpl_accounts_user_status ON gnpl_accounts (telegram_user_id, status);
CREATE INDEX IF NOT EXISTS idx_gnpl_accounts_trip_status ON gnpl_accounts (trip_id, status);
CREATE INDEX IF NOT EXISTS idx_gnpl_accounts_due_date ON gnpl_accounts (due_date);
CREATE INDEX IF NOT EXISTS idx_gnpl_accounts_next_penalty ON gnpl_accounts (next_penalty_at);
CREATE INDEX IF NOT EXISTS idx_gnpl_accounts_phone ON gnpl_accounts (customer_phone);
CREATE INDEX IF NOT EXISTS idx_gnpl_accounts_id_number ON gnpl_accounts (id_number);

CREATE INDEX IF NOT EXISTS idx_gnpl_payments_account_status ON gnpl_payments (gnpl_account_id, status);
CREATE INDEX IF NOT EXISTS idx_gnpl_payments_reference ON gnpl_payments (payment_reference);
CREATE INDEX IF NOT EXISTS idx_gnpl_payments_date ON gnpl_payments (payment_date);

