-- Board meeting tables and RLS for live notes + saved playback

CREATE TABLE IF NOT EXISTS board_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'live', -- live | recorded | completed
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  recording_url TEXT,
  recording_path TEXT,
  duration_seconds INTEGER,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS board_meeting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES board_meetings(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  note_time_seconds INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE board_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_meeting_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view board meetings" ON board_meetings;
CREATE POLICY "Authenticated users can view board meetings"
  ON board_meetings FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can create board meetings" ON board_meetings;
CREATE POLICY "Authenticated users can create board meetings"
  ON board_meetings FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update board meetings" ON board_meetings;
CREATE POLICY "Authenticated users can update board meetings"
  ON board_meetings FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete board meetings" ON board_meetings;
CREATE POLICY "Authenticated users can delete board meetings"
  ON board_meetings FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can view meeting notes" ON board_meeting_notes;
CREATE POLICY "Authenticated users can view meeting notes"
  ON board_meeting_notes FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can add meeting notes" ON board_meeting_notes;
CREATE POLICY "Authenticated users can add meeting notes"
  ON board_meeting_notes FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update meeting notes" ON board_meeting_notes;
CREATE POLICY "Authenticated users can update meeting notes"
  ON board_meeting_notes FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete meeting notes" ON board_meeting_notes;
CREATE POLICY "Authenticated users can delete meeting notes"
  ON board_meeting_notes FOR DELETE
  USING (auth.role() = 'authenticated');