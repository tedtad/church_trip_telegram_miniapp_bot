-- Fix invitations current_uses backfill for databases that do not have used_count.
-- Safe and idempotent.

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS current_uses INTEGER DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invitations'
      AND column_name = 'used_count'
  ) THEN
    EXECUTE '
      UPDATE invitations
      SET current_uses = COALESCE(current_uses, used_count, 0)
      WHERE current_uses IS NULL
    ';
  ELSE
    EXECUTE '
      UPDATE invitations
      SET current_uses = COALESCE(current_uses, 0)
      WHERE current_uses IS NULL
    ';
  END IF;
END $$;
