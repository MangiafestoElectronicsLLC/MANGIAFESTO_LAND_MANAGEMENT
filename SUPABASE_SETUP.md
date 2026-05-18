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

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_history ENABLE ROW LEVEL SECURITY;

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

4. Run `npm run dev` and test the app!

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
