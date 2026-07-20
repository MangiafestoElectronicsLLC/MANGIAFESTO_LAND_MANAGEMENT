-- Property maps database for planning builds, trails, gates, and notes

CREATE TABLE IF NOT EXISTS property_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Family Property Map',
  address TEXT NOT NULL DEFAULT '825 West Ave, Brockport, NY',
  center_lat DOUBLE PRECISION NOT NULL DEFAULT 43.2137,
  center_lng DOUBLE PRECISION NOT NULL DEFAULT -77.9417,
  base_image_url TEXT,
  base_image_path TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_map_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES property_maps(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  feature_type TEXT NOT NULL DEFAULT 'note',
  status TEXT NOT NULL DEFAULT 'planned',
  description TEXT,
  x_percent DOUBLE PRECISION NOT NULL DEFAULT 50,
  y_percent DOUBLE PRECISION NOT NULL DEFAULT 50,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT property_map_feature_type_chk
    CHECK (feature_type IN ('build', 'trail', 'gate', 'road', 'utility', 'water', 'note')),
  CONSTRAINT property_map_feature_status_chk
    CHECK (status IN ('planned', 'active', 'completed', 'blocked')),
  CONSTRAINT property_map_feature_x_chk
    CHECK (x_percent >= 0 AND x_percent <= 100),
  CONSTRAINT property_map_feature_y_chk
    CHECK (y_percent >= 0 AND y_percent <= 100)
);

ALTER TABLE property_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_map_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view property maps" ON property_maps;
CREATE POLICY "Authenticated users can view property maps"
  ON property_maps FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can create property maps" ON property_maps;
CREATE POLICY "Authenticated users can create property maps"
  ON property_maps FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update property maps" ON property_maps;
CREATE POLICY "Authenticated users can update property maps"
  ON property_maps FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete property maps" ON property_maps;
CREATE POLICY "Authenticated users can delete property maps"
  ON property_maps FOR DELETE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can view property map features" ON property_map_features;
CREATE POLICY "Authenticated users can view property map features"
  ON property_map_features FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can create property map features" ON property_map_features;
CREATE POLICY "Authenticated users can create property map features"
  ON property_map_features FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update property map features" ON property_map_features;
CREATE POLICY "Authenticated users can update property map features"
  ON property_map_features FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete property map features" ON property_map_features;
CREATE POLICY "Authenticated users can delete property map features"
  ON property_map_features FOR DELETE
  USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION touch_property_map_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS property_maps_touch_updated_at ON property_maps;
CREATE TRIGGER property_maps_touch_updated_at
BEFORE UPDATE ON property_maps
FOR EACH ROW EXECUTE FUNCTION touch_property_map_updated_at();

DROP TRIGGER IF EXISTS property_map_features_touch_updated_at ON property_map_features;
CREATE TRIGGER property_map_features_touch_updated_at
BEFORE UPDATE ON property_map_features
FOR EACH ROW EXECUTE FUNCTION touch_property_map_updated_at();
