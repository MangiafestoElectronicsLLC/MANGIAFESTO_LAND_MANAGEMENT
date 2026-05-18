# Quick Start (Non-Tech Users)

Follow these 5 easy steps to get the app running on your computer. **No coding knowledge required!**

---

## 1. Download & Install Prerequisites

### Install Node.js
1. Go to [nodejs.org](https://nodejs.org)
2. Click the **LTS** button (green, left side)
3. Run the installer and follow prompts
4. When asked "Add to PATH", click **YES**
5. Restart your computer

### Install Git
1. Go to [git-scm.com](https://git-scm.com)
2. Click **Download**
3. Run the installer and follow prompts
4. Restart your computer

---

## 2. Clone the App

1. Open **Command Prompt** (search: "cmd")
2. Paste this command (right-click to paste):

   ```
   git clone https://github.com/YOUR_USERNAME/family-land-board.git
   ```
   
   Replace `YOUR_USERNAME` with your actual GitHub username.

3. Press **Enter**
4. Wait a few seconds for it to finish

---

## 3. Install Dependencies

In Command Prompt, type:

```
cd family-land-board
npm install
```

Wait a few minutes for it to finish (lots of text will scroll by - that's normal).

---

## 4. Create Your Database (Supabase)

This is the server that stores all your data.

1. Go to [supabase.com](https://supabase.com)
2. Click **Sign Up** and create an account
3. Click **New Project** → Choose any **Region** → Click **Create new project**
4. Wait 2-3 minutes for setup
5. Go to **SQL Editor** → Click **New Query**
6. Go back to your project folder and open the file called `SUPABASE_SETUP.md`
7. Copy all the SQL code (everything in the code block)
8. Paste it into the Supabase SQL Editor
9. Click **Run**
10. Wait for completion

---

## 5. Get Your Database Keys

1. In Supabase, click **Project Settings** (bottom left)
2. Click **API**
3. You'll see two important values:
   - **Project URL** - copy this
   - **Anon Key** - copy this

---

## 6. Add Keys to Your App

1. In your project folder, find the file `.env.local.example`
2. Right-click it → **Rename** → Delete `.example` so it becomes `.env.local`
3. Right-click `.env.local` → **Open with** → **Notepad**
4. Replace:
   - `YOURSUPABASE_URL` with your **Project URL**
   - `YOURSUPABASEANON_KEY` with your **Anon Key**
5. Save and close

---

## 7. Run the App

In Command Prompt, type:

```
npm run dev
```

Wait a few seconds, then copy-paste this into your browser:

```
http://localhost:3000
```

You should see the login page! 🎉

---

## 8. Create Your First Account

1. Click **Sign up**
2. Enter your email and password
3. Click **Sign up**
4. You'll be logged in!

---

## 9. Set User Roles (Admin Only)

To assign roles to users (Chairman, Legal, etc.):

1. In Supabase, click **Table Editor**
2. Click **profiles**
3. Find the user row
4. Click the `role_id` cell
5. Type the ID of the role:
   - **1** = Chairman
   - **2** = Grounds
   - **3** = Legal
   - **4** = Technology
6. Press Enter

Now that user has a role!

---

## Done!

Your app is now running locally. You can:
- Create tickets
- Change ticket status (Open → In Progress → Closed)
- Assign tickets to roles
- Set priority levels

---

## Next: Deploy to the Internet (Optional)

Want your app live online so everyone can access it anytime?

See **DEPLOYMENT_GUIDE.md** for instructions to deploy to Vercel (free).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "npm not found" | Reinstall Node.js and restart computer |
| "Cannot connect to Supabase" | Check your `.env.local` file has correct keys |
| "Port 3000 already in use" | Close other apps or run `npm run dev -- -p 3001` |
| "Sign up not working" | Check Supabase Authentication → Providers has **Email** enabled |

---

## Getting Help

If you get stuck:
1. Check this document again
2. Ask someone tech-savvy in your family
3. Search Google for the error message
4. Visit [Supabase docs](https://supabase.com/docs) or [Next.js docs](https://nextjs.org/docs)
