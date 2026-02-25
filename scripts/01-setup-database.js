import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const SQL = `
-- Telegram Ticket Reservation System Database Schema

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

-- 6. Activity Log
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

-- 7. Approvals
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  status TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Admin Invitations
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

-- 10. Telegram Channels
CREATE TABLE IF NOT EXISTS telegram_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  channel_id BIGINT UNIQUE,
  channel_name TEXT,
  channel_username TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
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

-- Functions and Triggers
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
`;

async function setupDatabase() {
  try {
    console.log('[v0] Starting database setup...');
    
    // Execute the SQL using Supabase SQL interface
    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: SQL
    });

    if (error) {
      console.error('[v0] Database setup error:', error);
      throw error;
    }

    console.log('[v0] Database setup completed successfully!');
    console.log('[v0] Created 10 tables with indexes and triggers');
  } catch (error) {
    console.error('[v0] Failed to setup database:', error.message);
    process.exit(1);
  }
}

setupDatabase();
