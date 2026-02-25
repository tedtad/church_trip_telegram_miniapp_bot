-- Charity promises + manual cash reconciliation enhancements
-- Safe to run multiple times.

-- 1) Invitation target metadata fallback for robust invite resolution
ALTER TABLE IF EXISTS invitations
  ADD COLUMN IF NOT EXISTS target TEXT DEFAULT 'booking',
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES charity_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invitations_target ON invitations(target);
CREATE INDEX IF NOT EXISTS idx_invitations_campaign_id ON invitations(campaign_id);

-- 2) Charity promises
CREATE TABLE IF NOT EXISTS charity_promises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES charity_campaigns(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  donor_name TEXT NOT NULL,
  donor_phone TEXT,
  promise_type TEXT NOT NULL DEFAULT 'cash',
  pledged_amount NUMERIC(12,2),
  item_description TEXT,
  reference_note TEXT,
  due_at TIMESTAMPTZ,
  reminder_days_before INTEGER DEFAULT 1,
  last_reminder_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  invitation_code TEXT,
  invitation_id UUID REFERENCES invitations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_charity_promises_campaign_id ON charity_promises(campaign_id);
CREATE INDEX IF NOT EXISTS idx_charity_promises_user_id ON charity_promises(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_charity_promises_status ON charity_promises(status);
CREATE INDEX IF NOT EXISTS idx_charity_promises_due_at ON charity_promises(due_at);

-- 3) Charity promise executions
CREATE TABLE IF NOT EXISTS charity_promise_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promise_id UUID NOT NULL REFERENCES charity_promises(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES charity_campaigns(id) ON DELETE SET NULL,
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  execution_type TEXT NOT NULL DEFAULT 'cash_collection',
  donation_id UUID REFERENCES charity_donations(id) ON DELETE SET NULL,
  reference_number TEXT,
  receipt_file_url TEXT,
  receipt_file_name TEXT,
  in_kind_details TEXT,
  in_kind_estimated_value NUMERIC(12,2),
  notes TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_charity_promise_exec_promise_id ON charity_promise_executions(promise_id);
CREATE INDEX IF NOT EXISTS idx_charity_promise_exec_campaign_id ON charity_promise_executions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_charity_promise_exec_user_id ON charity_promise_executions(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_charity_promise_exec_status ON charity_promise_executions(approval_status);
CREATE INDEX IF NOT EXISTS idx_charity_promise_exec_type ON charity_promise_executions(execution_type);

-- 4) Donation linkage for promise execution lifecycle
ALTER TABLE IF EXISTS charity_donations
  ADD COLUMN IF NOT EXISTS promise_id UUID REFERENCES charity_promises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promise_execution_id UUID REFERENCES charity_promise_executions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_charity_donations_promise_id ON charity_donations(promise_id);
CREATE INDEX IF NOT EXISTS idx_charity_donations_promise_execution_id ON charity_donations(promise_execution_id);

-- 5) Manual cash sales tagging + remittance workflow
ALTER TABLE IF EXISTS receipts
  ADD COLUMN IF NOT EXISTS manual_sale_admin_id TEXT,
  ADD COLUMN IF NOT EXISTS manual_sale_channel TEXT;

CREATE INDEX IF NOT EXISTS idx_receipts_manual_sale_admin_id ON receipts(manual_sale_admin_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment_method_created_at ON receipts(payment_method, created_at DESC);

CREATE TABLE IF NOT EXISTS manual_cash_remittances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by_admin_id TEXT NOT NULL,
  total_cash_sold NUMERIC(12,2) NOT NULL DEFAULT 0,
  already_remitted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  outstanding_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  remitted_amount NUMERIC(12,2) NOT NULL,
  remittance_method TEXT NOT NULL DEFAULT 'cash_handover',
  bank_receipt_url TEXT,
  bank_receipt_file_name TEXT,
  notes TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_by_admin_id TEXT,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_cash_remittances_submitter ON manual_cash_remittances(submitted_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_manual_cash_remittances_status ON manual_cash_remittances(approval_status);
CREATE INDEX IF NOT EXISTS idx_manual_cash_remittances_created_at ON manual_cash_remittances(created_at DESC);

-- 6) Settings for designated remittance approver and promise reminders
ALTER TABLE IF EXISTS app_settings
  ADD COLUMN IF NOT EXISTS manual_cash_approver_role TEXT DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS charity_promise_reminder_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS charity_promise_reminder_days_before INTEGER DEFAULT 1;

