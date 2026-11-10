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

## Off-Grid Comms (Meshtastic)

Meshtastic does not use a central account to connect radios. Sign in to Family
Land Board while online and open Off-Grid Comms to use the built-in radio interface.
The optional **Use official client** button opens the official Meshtastic web
client. If the embed or device picker does not work, use its link to open the
official client in Chrome or Edge. It requires its own direct radio connection
and cannot use a connection held by the phone app. The hosted client needs
internet to load; test offline operation in advance.
The official and built-in clients do not share connections, message history, or
waiting messages. Disconnect the official client before connecting the same
radio to the built-in chat. Waiting built-in messages send only when requested.
Connect a powered Meshtastic radio using Bluetooth or USB. Each family member needs a radio within mesh
range, configured for the correct region and compatible modem and primary
channel settings. Use a private channel key for family conversations; the
default public channel is not private.

Chrome or Edge with a secure context (HTTPS or localhost) is recommended for
Bluetooth and Web Serial USB. Disconnect the radio from the Meshtastic phone
app before connecting over Bluetooth. USB connects to the computer running the
browser; the optional server USB bridge instead requires a radio on the app
server and is disabled in production unless `MESH_BRIDGE_ENABLED=1`. The bridge
is intended for a trusted local server, not a hosted deployment.

The built-in chat sends to the primary channel or directly to a selected node;
it does not support other channels. Verify node IDs with family before sending.
Direct-message privacy depends on firmware, keys and radio configuration; do
not assume it is private simply because a recipient is selected. History and waiting messages stay in that browser,
not the user's account. Waiting messages send when you choose **Send waiting
messages**: group messages use the connected radio's primary channel, while
direct messages require their original sending radio. A sent message does not prove that anyone
received it; request a reply and test radio coverage in advance.

The node list includes radios your node has heard, potentially through relays
or MQTT. A name or appearance in the list does not identify its owner, imply
membership in your group, or confirm current reachability. The public default
primary channel key does not provide private group conversations.
In the built-in chat, use **Family radios** to select verified full node IDs.
Locally selected nodes and shared account assignments appear as direct-message
recipients. Waiting direct messages require the recipient to remain approved;
those addressed to an assigned account require that account to still have the
same radio. This browser-local list does not filter the official client or
prevent other radios from hearing broadcasts.

To share account-to-radio assignments, run
[`supabase/meshtastic_radio_assignments.sql`](supabase/meshtastic_radio_assignments.sql)
in the Supabase SQL Editor. The server also needs `ADMIN_EMAILS` and
`SUPABASE_SERVICE_ROLE_KEY` configured for an admin to make changes.
Under **Radios assigned to accounts**, select an account and enter the radio's
complete eight-digit node ID, verified on the device or in Meshtastic. Each
account and radio may have one assignment. Signed-in users can see assignments
and select an assigned person as a direct-message recipient; an assignment is
only a label, not a radio connection or a security control. If a different
radio is connected, replies go to that radio, not automatically to the one
assigned to the account. A radio can still be used with the Meshtastic app
after disconnecting it from this website.

Assignments do not create an account inbox or synchronize messages with other
browsers or the Meshtastic app. The website receives radio messages only while
its radio connection and page are active; an always-on gateway and a separate
account inbox would be needed to deliver messages to accounts when the page is
closed. Shared assignments load while online and remain available for the
current open page if internet connectivity is lost. Reload the page when
assignments change, and verify them before sending; an offline page cannot
learn about subsequent changes.

Radio communication does not need cellular service or internet, but the app
and its sign-in normally do. Open and sign in to the page before going offline
and keep it open; reopening the app or signing in while offline is not
guaranteed. The computer and any local server/bridge must remain powered.
Do not depend on this page as the only means of emergency communication.

For Wi-Fi radios, the browser must be able to reach the radio and the app server
must allow network connections to it. Development allows these connections;
production requires `MESH_ALLOW_HTTP_NODES=1`, which broadens the app's
Content Security Policy to allow HTTP and HTTPS connections. Browsers block
HTTP radios from HTTPS pages; use an HTTPS radio address and first trust its
certificate in the browser. Browser CORS and network restrictions still apply.

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
