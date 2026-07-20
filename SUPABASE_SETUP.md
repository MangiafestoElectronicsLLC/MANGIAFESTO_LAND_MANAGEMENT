# Supabase Setup Guide

Copy and run all the SQL code below in your Supabase project to set up the database schema.

## Steps

1. Go to [Supabase.com](https://supabase.com) and create a project
2. In your project, go to **SQL Editor**
3. Click **New Query**
4. Paste all the code below
5. Click **Run**
6. Wait for completion (a few seconds)

---

## SQL Schema

```sql
-- Create ROLES table
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
);

-- Insert default roles
INSERT INTO roles (name) VALUES
  ('Chairman'),
  ('Legal'),
  ('Grounds'),
  ('Technology');

-- Create PROFILES table (linked to auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  role_id UUID REFERENCES roles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create TICKETS table
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',  -- open | in_progress | closed
  priority TEXT NOT NULL DEFAULT 'normal',  -- low | normal | high
  role_id UUID REFERENCES roles(id),
  created_by UUID REFERENCES profiles(id),
  assigned_to UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create TICKET_HISTORY table (audit log)
CREATE TABLE ticket_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  action TEXT NOT NULL,  -- created | updated | status_changed | closed
  performed_by UUID REFERENCES profiles(id),
  from_status TEXT,
  to_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add persisted ticket numbers (TKT-<year>-<sequence>)
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1000;

CREATE OR REPLACE FUNCTION set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR btrim(NEW.ticket_number) = '' THEN
    NEW.ticket_number := 'TKT-' || to_char(COALESCE(NEW.created_at, NOW()), 'YYYY') || '-' || lpad(nextval('ticket_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_set_ticket_number ON tickets;
CREATE TRIGGER tickets_set_ticket_number
BEFORE INSERT ON tickets
FOR EACH ROW EXECUTE FUNCTION set_ticket_number();

-- Create BOARD MEETINGS tables
CREATE TABLE board_meetings (
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

CREATE TABLE board_meeting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES board_meetings(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  note_time_seconds INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create PROPERTY MAP tables
CREATE TABLE property_maps (
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

CREATE TABLE property_map_features (
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
    CHECK (status IN ('planned', 'active', 'completed', 'blocked'))
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_map_features ENABLE ROW LEVEL SECURITY;

-- RLS Policies for PROFILES
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- RLS Policies for TICKETS (all authenticated users can view/create)
CREATE POLICY "Authenticated users can view all tickets"
  ON tickets FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create tickets"
  ON tickets FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update tickets"
  ON tickets FOR UPDATE
  USING (auth.role() = 'authenticated');

-- RLS Policies for TICKET_HISTORY
CREATE POLICY "Authenticated users can view ticket history"
  ON ticket_history FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert history"
  ON ticket_history FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- RLS Policies for BOARD MEETINGS
CREATE POLICY "Authenticated users can view board meetings"
  ON board_meetings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create board meetings"
  ON board_meetings FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update board meetings"
  ON board_meetings FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete board meetings"
  ON board_meetings FOR DELETE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view meeting notes"
  ON board_meeting_notes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert meeting notes"
  ON board_meeting_notes FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view property maps"
  ON property_maps FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create property maps"
  ON property_maps FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update property maps"
  ON property_maps FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete property maps"
  ON property_maps FOR DELETE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view property map features"
  ON property_map_features FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create property map features"
  ON property_map_features FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update property map features"
  ON property_map_features FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete property map features"
  ON property_map_features FOR DELETE
  USING (auth.role() = 'authenticated');
```

---

## What Was Created

### Tables

| Table | Purpose |
|-------|---------|
| `roles` | 4 predefined roles (Chairman, Legal, Grounds, Technology) |
| `profiles` | User profiles linked to authentication |
| `tickets` | Tasks/issues with status, priority, and timestamps |
| `ticket_history` | Audit trail of all ticket changes |
| `board_meetings` | Meeting recordings and metadata |
| `board_meeting_notes` | Timestamp notes for meetings |
| `property_maps` | Property map metadata and base image URL |
| `property_map_features` | Build/trail markers and planning data |

### Roles

- **Chairman** - Can manage all aspects of the system
- **Legal** - Handles legal matters
- **Grounds** - Handles maintenance and grounds work
- **Technology** - Handles tech support and systems

### Ticket Fields

- **title** - Name of the task
- **description** - Details
- **status** - open, in_progress, or closed
- **priority** - low, normal, or high
- **role_id** - Which role this ticket is for
- **created_by** - Who created it
- **assigned_to** - Who it's assigned to
- **created_at** - When it was created (automatic)
- **updated_at** - When it was last updated (automatic)

---

## Next Steps

1. Enable Email/Password auth:
   - Go to **Authentication** → **Providers**
   - Toggle **Email** to ON

2. Copy your API credentials:
   - Go to **Project Settings** → **API**
   - Copy **Project URL** and **Anon Key**

3. Add them to your `.env.local` file (see README.md)

4. Run these additional SQL scripts in Supabase SQL Editor:
  - `supabase/ticket_numbers.sql`
  - `supabase/board_meetings.sql`
  - `supabase/property_maps.sql`
  - `supabase/storage_ticket_images.sql`
  - `supabase/storage_board_meetings.sql`
  - `supabase/storage_property_maps.sql`

5. Run `npm run dev` and test the app!

---

## Customizing Roles

Want different roles? Edit the INSERT statement:

```sql
INSERT INTO roles (name) VALUES
  ('Role Name 1'),
  ('Role Name 2'),
  ('Role Name 3');
```

Then restart the app to see the new roles in the ticket creation form.

---

## Security Note

The Row Level Security (RLS) policies above allow all authenticated users to see all tickets. If you want to restrict who can see what, you'll need to modify the policies. For example, to restrict tickets by role:

```sql
-- Only show tickets for your role
CREATE POLICY "Users see tickets for their role"
  ON tickets FOR SELECT
  USING (
    (SELECT role_id FROM profiles WHERE id = auth.uid()) = role_id
    OR created_by = auth.uid()
  );
```

Contact support if you need help customizing security rules.
