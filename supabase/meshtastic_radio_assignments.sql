-- Run in the Supabase SQL Editor before using shared radio assignments.
CREATE TABLE IF NOT EXISTS public.meshtastic_radio_assignments (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  node_num bigint UNIQUE NOT NULL CHECK (node_num > 0 AND node_num < 4294967295),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meshtastic_radio_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meshtastic_radio_assignments FROM anon, authenticated;
GRANT SELECT ON public.meshtastic_radio_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meshtastic_radio_assignments TO service_role;

DROP POLICY IF EXISTS "Authenticated users can view radio assignments" ON public.meshtastic_radio_assignments;
CREATE POLICY "Authenticated users can view radio assignments"
  ON public.meshtastic_radio_assignments FOR SELECT
  TO authenticated USING (true);
