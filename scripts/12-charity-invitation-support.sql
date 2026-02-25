-- Charity donations linked to invitation codes
-- Safe to run multiple times.

ALTER TABLE IF EXISTS charity_donations
  ADD COLUMN IF NOT EXISTS invitation_code TEXT,
  ADD COLUMN IF NOT EXISTS invitation_id UUID REFERENCES invitations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_charity_donations_invitation_code
  ON charity_donations(invitation_code);

CREATE INDEX IF NOT EXISTS idx_charity_donations_invitation_id
  ON charity_donations(invitation_id);
