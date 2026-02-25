-- Telegram Ticket Reservation System Database Schema
-- Created for Supabase

-- 1. Telegram Users (Customers)
CREATE TABLE IF NOT EXISTS telegram_users (
  id BIGINT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  username TEXT UNIQUE,
  phone_number TEXT,
  language_code TEXT DEFAULT 'en',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'active'
);

-- 2. Trips
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  destination TEXT NOT NULL,
  departure_date TIMESTAMP WITH TIME ZONE NOT NULL,
  arrival_date TIMESTAMP WITH TIME ZONE,
  price_per_ticket DECIMAL(10, 2) NOT NULL,
  total_seats INT NOT NULL,
  available_seats INT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'active'
);

-- 3. Receipts (Payment References)
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number TEXT NOT NULL UNIQUE,
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL,
  amount_paid DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'ETB',
  quantity INT NOT NULL DEFAULT 1,
  receipt_file_url TEXT,
  receipt_file_name TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approval_status TEXT DEFAULT 'pending',
  approval_notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL UNIQUE,
  serial_number TEXT NOT NULL UNIQUE,
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id),
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id),
  seat_number TEXT,
  purchase_price DECIMAL(10, 2) NOT NULL,
  ticket_status TEXT DEFAULT 'pending',
  issued_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Admin Users
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'moderator',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login TIMESTAMP WITH TIME ZONE
);

-- 6. Activity Log (Track all admin actions)
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  action_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  description TEXT,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Approvals (Ticket Approval History)
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  status TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Admin Invitations (QR codes & links for customer acquisition)
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_code TEXT NOT NULL UNIQUE,
  qr_code_url TEXT,
  created_by UUID NOT NULL REFERENCES admin_users(id),
  trip_id UUID REFERENCES trips(id),
  max_uses INT,
  current_uses INT DEFAULT 0,
  discount_percent DECIMAL(5, 2) DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Telegram Channels (Auto-created when customer registers)
CREATE TABLE IF NOT EXISTS telegram_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  channel_id BIGINT UNIQUE,
  channel_name TEXT,
  channel_username TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. App Settings
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  app_name TEXT NOT NULL DEFAULT 'TicketHub',
  app_description TEXT NOT NULL DEFAULT 'Telegram Ticket Reservation System',
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
  telegram_channel_chat_id TEXT,
  telegram_channel_url TEXT,
  telegram_channel_name TEXT,
  telegram_post_new_trip BOOLEAN DEFAULT TRUE,
  telegram_post_weekly_summary BOOLEAN DEFAULT TRUE,
  telegram_post_daily_countdown BOOLEAN DEFAULT TRUE,
  telegram_recommendation_interval_hours INTEGER DEFAULT 24,
  telegram_last_recommendation_post_at TIMESTAMPTZ,
  telegram_last_weekly_post_at TIMESTAMPTZ,
  telegram_last_daily_post_date DATE,
  charity_channel_chat_id TEXT,
  charity_channel_url TEXT,
  charity_group_chat_id TEXT,
  charity_group_url TEXT,
  charity_auto_post_new_campaign BOOLEAN DEFAULT TRUE,
  charity_auto_post_summary BOOLEAN DEFAULT TRUE,
  charity_last_summary_post_at TIMESTAMPTZ,
  gnpl_enabled BOOLEAN DEFAULT FALSE,
  gnpl_require_admin_approval BOOLEAN DEFAULT TRUE,
  gnpl_default_term_days INTEGER DEFAULT 14,
  gnpl_penalty_enabled BOOLEAN DEFAULT TRUE,
  gnpl_penalty_percent NUMERIC(5,2) DEFAULT 5,
  gnpl_penalty_period_days INTEGER DEFAULT 7,
  gnpl_reminder_enabled BOOLEAN DEFAULT TRUE,
  gnpl_reminder_days_before INTEGER DEFAULT 0,
  receipt_intelligence_enabled BOOLEAN DEFAULT FALSE,
  receipt_sample_collection_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO app_settings (id, app_name, app_description)
VALUES ('default', 'TicketHub', 'Telegram Ticket Reservation System')
ON CONFLICT (id) DO NOTHING;

-- 12. Database Backups (Track all backup operations)
CREATE TABLE IF NOT EXISTS database_backups (
  id TEXT PRIMARY KEY,
  backup_data JSONB,
  status TEXT NOT NULL,
  error_message TEXT,
  size INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_receipts_reference ON receipts(reference_number);
CREATE INDEX IF NOT EXISTS idx_receipts_telegram_user ON receipts(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(approval_status);
CREATE INDEX IF NOT EXISTS idx_tickets_receipt ON tickets(receipt_id);
CREATE INDEX IF NOT EXISTS idx_tickets_trip ON tickets(trip_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_serial ON tickets(serial_number);
CREATE INDEX IF NOT EXISTS idx_activity_logs_admin ON activity_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(invitation_code);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_app_settings_updated_at ON app_settings(updated_at);
CREATE INDEX IF NOT EXISTS idx_backups_created ON database_backups(created_at);
CREATE INDEX IF NOT EXISTS idx_backups_status ON database_backups(status);

-- Update triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER IF NOT EXISTS update_receipts_updated_at BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_tickets_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_trips_updated_at BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_invitations_updated_at BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_app_settings_updated_at BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
