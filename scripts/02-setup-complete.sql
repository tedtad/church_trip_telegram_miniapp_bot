-- TicketHub Complete Database Setup
-- Run this in Supabase SQL Editor to create all tables with proper relationships

-- Drop existing tables if they exist (for fresh setup only)
-- DROP TABLE IF EXISTS database_backups CASCADE;
-- DROP TABLE IF EXISTS telegram_channels CASCADE;
-- DROP TABLE IF EXISTS notifications CASCADE;
-- DROP TABLE IF EXISTS invitations CASCADE;
-- DROP TABLE IF EXISTS approvals CASCADE;
-- DROP TABLE IF EXISTS activity_logs CASCADE;
-- DROP TABLE IF EXISTS tickets CASCADE;
-- DROP TABLE IF EXISTS receipts CASCADE;
-- DROP TABLE IF EXISTS admin_users CASCADE;
-- DROP TABLE IF EXISTS trips CASCADE;
-- DROP TABLE IF EXISTS telegram_users CASCADE;

-- 1. Telegram Users (Customers)
CREATE TABLE IF NOT EXISTS telegram_users (
  id BIGINT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  phone_number TEXT,
  language_code TEXT DEFAULT 'en',
  is_bot BOOLEAN DEFAULT FALSE,
  is_premium BOOLEAN DEFAULT FALSE,
  is_blocked BOOLEAN DEFAULT FALSE,
  registration_date TIMESTAMP DEFAULT NOW(),
  last_activity TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_telegram_users_username ON telegram_users(username);
CREATE INDEX idx_telegram_users_phone ON telegram_users(phone_number);
CREATE INDEX idx_telegram_users_language ON telegram_users(language_code);

-- 2. Trips
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  destination TEXT NOT NULL,
  image_url TEXT,
  departure_date TIMESTAMP NOT NULL,
  arrival_date TIMESTAMP,
  price_per_ticket DECIMAL(10, 2) NOT NULL,
  total_seats INT NOT NULL DEFAULT 1,
  available_seats INT NOT NULL DEFAULT 1,
  trip_status TEXT DEFAULT 'active', -- active, cancelled, completed
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_trips_status ON trips(trip_status);
CREATE INDEX idx_trips_departure ON trips(departure_date);

-- 3. Receipts (Payment References)
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number TEXT NOT NULL UNIQUE,
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL DEFAULT 'bank', -- bank, telebirr, cash, mobile_money
  amount_paid DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'ETB',
  quantity INT NOT NULL DEFAULT 1,
  receipt_file_url TEXT,
  receipt_file_name TEXT,
  receipt_hash TEXT, -- SHA256 hash to prevent duplicates
  uploaded_at TIMESTAMP DEFAULT NOW(),
  approval_status TEXT DEFAULT 'pending', -- pending, approved, rejected
  approval_notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_receipts_reference ON receipts(reference_number);
CREATE INDEX idx_receipts_status ON receipts(approval_status);
CREATE INDEX idx_receipts_user ON receipts(telegram_user_id);
CREATE INDEX idx_receipts_payment_method ON receipts(payment_method);

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
  ticket_status TEXT DEFAULT 'pending', -- pending, confirmed, cancelled, used
  qr_code TEXT, -- QR code data for ticket verification
  issued_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_tickets_serial ON tickets(serial_number);
CREATE UNIQUE INDEX idx_tickets_number ON tickets(ticket_number);
CREATE INDEX idx_tickets_status ON tickets(ticket_status);
CREATE INDEX idx_tickets_user ON tickets(telegram_user_id);
CREATE INDEX idx_tickets_trip ON tickets(trip_id);

-- 5. Admin Users
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'moderator', -- admin, moderator, analyst
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_users_role ON admin_users(role);
CREATE INDEX idx_admin_users_active ON admin_users(is_active);

-- 6. Activity Logs (Audit Trail)
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  description TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_admin ON activity_logs(admin_id);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at DESC);

-- 7. Approvals
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  notes TEXT,
  approval_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_approvals_receipt ON approvals(receipt_id);
CREATE INDEX idx_approvals_admin ON approvals(admin_id);
CREATE INDEX idx_approvals_status ON approvals(status);

-- 8. Invitations (QR/Link Invites)
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_code TEXT NOT NULL UNIQUE,
  qr_code_data TEXT,
  created_by UUID NOT NULL REFERENCES admin_users(id),
  trip_id UUID REFERENCES trips(id),
  max_uses INT,
  current_uses INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_invitations_code ON invitations(invitation_code);
CREATE INDEX idx_invitations_active ON invitations(is_active);
CREATE INDEX idx_invitations_trip ON invitations(trip_id);

-- 9. Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, -- approval, rejection, reminder, update
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_ticket_id UUID REFERENCES tickets(id),
  is_read BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(telegram_user_id);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
CREATE INDEX idx_notifications_read ON notifications(is_read);

-- 10. Telegram Channels (Auto-created for admin communication)
CREATE TABLE IF NOT EXISTS telegram_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id BIGINT UNIQUE,
  channel_name TEXT NOT NULL,
  channel_type TEXT DEFAULT 'group', -- group, channel, private
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_telegram_channels_id ON telegram_channels(channel_id);

-- 11. Telebirr Payment Records (for future integration)
CREATE TABLE IF NOT EXISTS telebirr_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  telebirr_transaction_id TEXT UNIQUE,
  telebirr_phone TEXT,
  status TEXT DEFAULT 'pending', -- pending, confirmed, failed
  amount DECIMAL(10, 2),
  response_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_telebirr_receipt ON telebirr_payments(receipt_id);
CREATE INDEX idx_telebirr_status ON telebirr_payments(status);

-- 12. App Settings
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
  telegram_last_recommendation_post_at TIMESTAMP,
  telegram_last_weekly_post_at TIMESTAMP,
  telegram_last_daily_post_date DATE,
  charity_channel_chat_id TEXT,
  charity_channel_url TEXT,
  charity_group_chat_id TEXT,
  charity_group_url TEXT,
  charity_auto_post_new_campaign BOOLEAN DEFAULT TRUE,
  charity_auto_post_summary BOOLEAN DEFAULT TRUE,
  charity_last_summary_post_at TIMESTAMP,
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
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO app_settings (id, app_name, app_description)
VALUES ('default', 'TicketHub', 'Telegram Ticket Reservation System')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX idx_app_settings_updated_at ON app_settings(updated_at DESC);

-- 13. Database Backups Log
CREATE TABLE IF NOT EXISTS database_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_id TEXT UNIQUE,
  backup_type TEXT DEFAULT 'full', -- full, partial, incremental
  status TEXT DEFAULT 'success', -- success, failed
  total_records INT,
  backup_size INT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_backups_status ON database_backups(status);
CREATE INDEX idx_backups_created ON database_backups(created_at DESC);

-- Auto-update timestamps function
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply auto-update triggers
CREATE TRIGGER update_telegram_users_timestamp BEFORE UPDATE ON telegram_users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_trips_timestamp BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_receipts_timestamp BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_tickets_timestamp BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_admin_users_timestamp BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_approvals_timestamp BEFORE UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_invitations_timestamp BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_telebirr_payments_timestamp BEFORE UPDATE ON telebirr_payments FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_telegram_channels_timestamp BEFORE UPDATE ON telegram_channels FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_app_settings_timestamp BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Enable RLS for security
ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE telebirr_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE database_backups ENABLE ROW LEVEL SECURITY;

-- Create simple RLS policies (open for now, tighten in production)
CREATE POLICY "allow_all_read" ON telegram_users FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON trips FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON receipts FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON tickets FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON admin_users FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON activity_logs FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON approvals FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON invitations FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON notifications FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON telegram_channels FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON telebirr_payments FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON app_settings FOR SELECT USING (true);
CREATE POLICY "allow_all_read" ON database_backups FOR SELECT USING (true);

-- Grant all permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- SUCCESS: All tables created with proper relationships, indexes, and triggers
-- Tables: telegram_users, trips, receipts, tickets, admin_users, activity_logs, 
--         approvals, invitations, notifications, telegram_channels, telebirr_payments, database_backups
