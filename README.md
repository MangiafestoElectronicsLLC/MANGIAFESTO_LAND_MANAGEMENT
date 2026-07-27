# Family Land Board

A simple, user-friendly web app for managing family land tasks and tickets. Built for non-technical users with role-based access (Chairman, Legal, Grounds, Technology).

## Features

- **Email Login** - Simple sign-up and sign-in
- **Fallback Login** - Magic link and password reset when password sign-in fails
- **Role-Based Access** - 4 predefined roles for team members
- **Ticket Management** - Create, update, and track tasks with status and priority
- **Board Meetings** - Record a live meeting, replay it later, and attach timestamped notes
- **Timestamps** - Automatic tracking of when tickets are created/updated
- **Basic Dashboard** - View all tickets and filter by status
- **Mobile Friendly** - Works on phones, tablets, and computers

## Quick Start (5 minutes)

### 1. Clone or Download This Repository

```bash
git clone https://github.com/YOUR_USERNAME/family-land-board.git
cd family-land-board
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Supabase (Database & Auth)

1. Go to [Supabase.com](https://supabase.com) and create a free account
2. Create a new project (choose any region close to you)
3. Wait for the project to initialize (2-3 minutes)
4. Go to **SQL Editor** → Click **New Query** → Paste the contents of [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)
5. Click **Run** to create the database tables
6. Also run [supabase/property_map_access_requests.sql](./supabase/property_map_access_requests.sql) to enable shared treestand/range requests across devices
7. Go to **Project Settings** → **API** → Copy:
   - Project URL (NEXT_PUBLIC_SUPABASE_URL)
   - Anon Key (NEXT_PUBLIC_SUPABASE_ANON_KEY)

### 4. Configure Environment Variables

1. Copy `.env.local.example` to `.env.local`:
   ```bash
   cp .env.local.example .env.local
   ```

2. Open `.env.local` and replace with your Supabase values:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
   ```

### 5. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign up with any email!

### 6. Set User Roles

After someone signs up, an admin (Chairman) needs to set their role:

1. In Supabase, go to **Table Editor** → **profiles**
2. Click the user row and set the `role_id` to one of:
   - **Chairman** (can manage everything)
   - **Legal** (legal matters)
   - **Grounds** (maintenance/grounds)
   - **Technology** (tech support)

## Deployment to Vercel + Supabase (Production)

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for step-by-step instructions.

**TL;DR:**
1. Push to GitHub
2. Connect repo to [Vercel](https://vercel.com)
3. Add Supabase environment variables in Vercel dashboard
4. Done! Your app is live.

## Folder Structure

```
family-land-board/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Main layout (header, footer)
│   │   ├── page.tsx            # Login/sign-up page
│   │   ├── globals.css         # Global styles
│   │   └── dashboard/
│   │       └── page.tsx        # Main dashboard (tickets)
│   ├── lib/
│   │   └── supabaseClient.ts   # Supabase connection
│   └── components/
│       ├── TicketForm.tsx      # Form to create tickets
│       └── TicketList.tsx      # List of all tickets
├── package.json
├── tsconfig.json
├── next.config.mjs
├── .env.local.example          # Template for env variables
└── README.md                    # This file
```

## Troubleshooting

### "Cannot find module '@supabase/auth-helpers-nextjs'"

Run: `npm install`

### "Invalid API key"

Check that your `.env.local` file has the correct Supabase URL and API key (copy from Supabase Project Settings > API).

### "Users can see other users' data"

By default, all authenticated users can see all tickets. To restrict this, modify the RLS policies in Supabase SQL Editor. See the comment in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

### Email sign-ups not working

Check that **Email/Password** auth is enabled in Supabase:
1. Go to **Authentication** → **Providers**
2. Make sure **Email** is toggled on

### Can’t sign in

Use the fallback buttons on the login page:
1. **Send magic link** for a quick one-tap sign-in
2. **Reset password email** if you need to set a new password
3. **Resend confirmation email** if the account was created but never confirmed

The email links route through [src/app/auth/confirm/page.tsx](./src/app/auth/confirm/page.tsx), which finishes the login or password reset.

## Development

- **Edit pages**: `src/app/*.tsx`
- **Edit components**: `src/components/*.tsx`
- **Edit database logic**: Modify Supabase queries in components
- **Change colors/styling**: Edit the inline `style` props in components

## Database Schema

See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for the full SQL schema, including:
- **roles** - Chairman, Legal, Grounds, Technology
- **profiles** - User profiles linked to auth
- **tickets** - Tasks with status, priority, role, timestamps
- **ticket_history** - Audit log of changes
- **board_meetings** - Saved meeting sessions with recording metadata
- **board_meeting_notes** - Timestamped notes tied to a meeting

## Board Meetings Setup

To enable board meeting recording and notes:

1. Run the board meeting SQL in [supabase/board_meetings.sql](./supabase/board_meetings.sql)
2. Run the storage SQL in [supabase/storage_board_meetings.sql](./supabase/storage_board_meetings.sql)
3. Open the new Board Meetings page from the top navigation

The meeting tool works in the browser, so camera/mic permissions must be allowed on the device you use.

## License

This project is open source and free to use.

## Support

- Stuck? Check the [Supabase docs](https://supabase.com/docs)
- Questions about Next.js? See [Next.js docs](https://nextjs.org/docs)
- Issues with the app? Create an issue on GitHub or ask in Discussions
