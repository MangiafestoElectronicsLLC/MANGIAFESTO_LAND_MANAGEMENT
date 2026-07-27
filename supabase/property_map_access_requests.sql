-- Requests for family members to reserve or mark active use of treestands and ranges

CREATE TABLE IF NOT EXISTS property_map_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES property_maps(id) ON DELETE CASCADE,
  feature_id UUID REFERENCES property_map_features(id) ON DELETE SET NULL,
  requester_name TEXT NOT NULL,
  request_window TEXT NOT NULL DEFAULT 'day',
  requested_date DATE NOT NULL DEFAULT CURRENT_DATE,
  return_date DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_map_access_request_window_chk
    CHECK (request_window IN ('day', 'weekend', 'custom')),
  CONSTRAINT property_map_access_request_status_chk
    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled'))
);

ALTER TABLE property_map_access_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view property map access requests" ON property_map_access_requests;
CREATE POLICY "Authenticated users can view property map access requests"
  ON property_map_access_requests FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can create property map access requests" ON property_map_access_requests;
CREATE POLICY "Authenticated users can create property map access requests"
  ON property_map_access_requests FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update property map access requests" ON property_map_access_requests;
CREATE POLICY "Authenticated users can update property map access requests"
  ON property_map_access_requests FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete property map access requests" ON property_map_access_requests;
CREATE POLICY "Authenticated users can delete property map access requests"
  ON property_map_access_requests FOR DELETE
  USING (auth.role() = 'authenticated');

CREATE TRIGGER property_map_access_requests_touch_updated_at
BEFORE UPDATE ON property_map_access_requests
FOR EACH ROW EXECUTE FUNCTION touch_property_map_updated_at();