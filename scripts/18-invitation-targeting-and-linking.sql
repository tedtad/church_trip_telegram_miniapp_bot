-- Invitation targeting + linked entity guardrails
-- Safe to run multiple times.

-- 1) Track per-invitation target users (public invite = no rows)
CREATE TABLE IF NOT EXISTS invitation_target_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(invitation_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_invitation_target_users_invitation_id
  ON invitation_target_users(invitation_id);

CREATE INDEX IF NOT EXISTS idx_invitation_target_users_telegram_user_id
  ON invitation_target_users(telegram_user_id);

-- 2) Ensure invitation `target` has normalized default when column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invitations'
      AND column_name = 'target'
  ) THEN
    UPDATE invitations
    SET target = 'booking'
    WHERE COALESCE(TRIM(target), '') = '';
  END IF;
END $$;

