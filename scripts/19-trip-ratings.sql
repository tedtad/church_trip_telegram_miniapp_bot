-- Trip ratings submitted by mini app users after completed trips
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS trip_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticket_id),
  UNIQUE(ticket_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_ratings_trip_id ON trip_ratings(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_ratings_user_id ON trip_ratings(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_trip_ratings_rating ON trip_ratings(rating);
CREATE INDEX IF NOT EXISTS idx_trip_ratings_created_at ON trip_ratings(created_at DESC);
