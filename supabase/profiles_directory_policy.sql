-- Allow authenticated users to read profile names so activity can show who did what

DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;

CREATE POLICY "Authenticated users can view profiles"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Keep insert scoped to self
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Optional self-update policy
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
