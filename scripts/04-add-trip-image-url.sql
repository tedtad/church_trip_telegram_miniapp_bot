-- Add optional trip image URL for admin trip creation/editing.
-- This image is used as a background for generated digital ticket cards.

ALTER TABLE trips
ADD COLUMN IF NOT EXISTS image_url TEXT;

