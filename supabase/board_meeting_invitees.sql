-- Shared contact directory for board meeting invitations

CREATE TABLE IF NOT EXISTS board_meeting_invitees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT board_meeting_invitees_contact_chk
    CHECK (NULLIF(BTRIM(COALESCE(email, '')), '') IS NOT NULL OR NULLIF(BTRIM(COALESCE(phone, '')), '') IS NOT NULL)
);

ALTER TABLE board_meeting_invitees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view board meeting invitees" ON board_meeting_invitees;
CREATE POLICY "Authenticated users can view board meeting invitees"
  ON board_meeting_invitees FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can create board meeting invitees" ON board_meeting_invitees;
CREATE POLICY "Authenticated users can create board meeting invitees"
  ON board_meeting_invitees FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update board meeting invitees" ON board_meeting_invitees;
CREATE POLICY "Authenticated users can update board meeting invitees"
  ON board_meeting_invitees FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete board meeting invitees" ON board_meeting_invitees;
CREATE POLICY "Authenticated users can delete board meeting invitees"
  ON board_meeting_invitees FOR DELETE
  USING (auth.role() = 'authenticated');