-- Run once in the Supabase SQL editor if saving treestands/ranges fails with
-- 'violates check constraint "property_map_feature_type_chk"'.
ALTER TABLE property_map_features DROP CONSTRAINT IF EXISTS property_map_feature_type_chk;
ALTER TABLE property_map_features
  ADD CONSTRAINT property_map_feature_type_chk
  CHECK (feature_type IN ('build', 'trail', 'gate', 'road', 'utility', 'water', 'note', 'treestand', 'range'));
