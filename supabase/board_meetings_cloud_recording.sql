-- Metadata for managed Daily rooms and recordings that continue after the host leaves.

ALTER TABLE board_meetings
  ADD COLUMN IF NOT EXISTS call_provider TEXT,
  ADD COLUMN IF NOT EXISTS call_room_name TEXT,
  ADD COLUMN IF NOT EXISTS call_url TEXT,
  ADD COLUMN IF NOT EXISTS recording_provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_recording_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS board_meetings_call_room_name_unique
  ON board_meetings (call_room_name)
  WHERE call_room_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS board_meetings_provider_recording_id_idx
  ON board_meetings (provider_recording_id)
  WHERE provider_recording_id IS NOT NULL;