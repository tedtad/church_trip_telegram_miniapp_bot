-- Charity Campaigns Table
CREATE TABLE IF NOT EXISTS charity_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  cause TEXT NOT NULL,
  goal_amount DECIMAL(12, 2) NOT NULL,
  collected_amount DECIMAL(12, 2) DEFAULT 0,
  status TEXT DEFAULT 'active',
  start_date TIMESTAMP DEFAULT NOW(),
  end_date TIMESTAMP,
  created_by UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Charity Donations Table
CREATE TABLE IF NOT EXISTS charity_donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES charity_campaigns(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  donor_name TEXT NOT NULL,
  donor_phone TEXT,
  donation_amount DECIMAL(12, 2) NOT NULL,
  payment_method TEXT NOT NULL,
  reference_number TEXT UNIQUE NOT NULL,
  receipt_file_url TEXT,
  receipt_file_name TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW(),
  approval_status TEXT DEFAULT 'pending',
  approval_notes TEXT,
  approved_by UUID,
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  thank_you_card_generated BOOLEAN DEFAULT FALSE,
  thank_you_card_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Thank You Cards Table
CREATE TABLE IF NOT EXISTS thank_you_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id UUID NOT NULL REFERENCES charity_donations(id) ON DELETE CASCADE,
  template_id TEXT DEFAULT 'default',
  card_url TEXT,
  sent_via_telegram BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP,
  viewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_charity_campaigns_status ON charity_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_charity_donations_campaign ON charity_donations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_charity_donations_user ON charity_donations(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_charity_donations_status ON charity_donations(approval_status);
CREATE INDEX IF NOT EXISTS idx_thank_you_cards_donation ON thank_you_cards(donation_id);
