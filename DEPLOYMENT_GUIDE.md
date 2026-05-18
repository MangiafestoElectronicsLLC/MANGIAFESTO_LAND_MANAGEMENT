# Deployment Guide: Vercel + Supabase

This guide will help you deploy your Family Land Board app to the internet so it's always available.

## Prerequisites

- GitHub account ([github.com](https://github.com)) - FREE
- Vercel account ([vercel.com](https://vercel.com)) - FREE
- Supabase project already set up (see README.md)

**Time required:** ~15 minutes

---

## Step 1: Push to GitHub

### 1.1 Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Create a repository named `family-land-board`
3. Do NOT initialize with README (you already have one)
4. Click **Create repository**

### 1.2 Push Your Code

In your project folder, run:

```bash
git init
git add .
git commit -m "Initial commit: Family Land Board"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/family-land-board.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

---

## Step 2: Deploy to Vercel

### 2.1 Connect Your Repository

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **New Project**
3. Click **Import Git Repository**
4. Click **GitHub** (if prompted, authorize Vercel)
5. Select **family-land-board** from the list
6. Click **Import**

### 2.2 Add Environment Variables

1. On the import page, scroll down to **Environment Variables**
2. Add two variables:

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase Anon Key |

   *Find these in Supabase: Project Settings → API*

3. Click **Deploy**

### 2.3 Wait for Deployment

Vercel will build and deploy your app (takes ~2-3 minutes). When it's done, you'll see a preview link like:

```
https://family-land-board-xxxxx.vercel.app
```

Click it to open your live app!

---

## Step 3: Set Up a Custom Domain (Optional)

Want a nicer URL like `https://familyland.com`?

### 3.1 Buy a Domain

1. Buy a domain from [Namecheap](https://www.namecheap.com), [Google Domains](https://domains.google.com), or [Vercel Domains](https://vercel.com/domains)

### 3.2 Connect to Vercel

1. In Vercel dashboard, open your project
2. Go to **Settings** → **Domains**
3. Enter your domain name
4. Follow the instructions to add DNS records
5. Wait a few minutes for it to activate

---

## Step 4: Update Your App

Whenever you make changes:

1. Edit files locally
2. Commit and push to GitHub:

   ```bash
   git add .
   git commit -m "Update tickets UI"
   git push
   ```

3. Vercel automatically redeploys your app (2-3 minutes)

---

## Troubleshooting

### Build fails with "Cannot find module..."

Make sure `.gitignore` doesn't exclude `package-lock.json`. If it does, remove that line.

### Environment variables not working

1. Check the spelling (case-sensitive!)
2. Verify you copied the values correctly from Supabase
3. Try clicking **Redeploy** in Vercel to rebuild with new variables

### Custom domain not working

1. Wait a few minutes (DNS can take up to 24 hours)
2. Verify DNS records are correct in your domain registrar
3. Check Vercel dashboard for any errors

### Users can't sign up

1. Check Supabase Email/Password auth is enabled (Authentication → Providers)
2. Check that your Supabase API key has the correct permissions (Project Settings → API)

---

## Security Checklist

- [ ] Never commit `.env.local` to GitHub (check `.gitignore`)
- [ ] Environment variables in Vercel are encrypted and hidden
- [ ] Only the Anon Key is exposed (limited permissions by design)
- [ ] All user data is protected by Supabase RLS policies

---

## Monitoring & Logs

### View Deployment Logs

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click your project
3. Go to **Deployments** tab
4. Click the deployment to see logs

### View Application Errors

1. In Vercel, go to **Functions** tab (for server-side errors)
2. Or open browser DevTools (F12) to see client-side errors

### View Supabase Activity

1. Go to your Supabase dashboard
2. Go to **Logs** to see database queries
3. Go to **Auth** to see sign-ups and login attempts

---

## Scaling & Performance

For a family team (5-20 people), the free tier is perfect:
- **Vercel** - unlimited deployments, auto-scaling
- **Supabase** - 500 MB database, plenty for thousands of tickets

If you need more:
- Supabase: Upgrade to Pro ($25/month)
- Vercel: Upgrade to Pro ($20/month) or Pro Team ($150/month)

---

## Next Steps

1. Share the live URL with your family
2. Test sign-ups and ticket creation
3. Set user roles in Supabase (see README.md)
4. Start creating tickets!

---

## Support

- **Vercel docs:** https://vercel.com/docs
- **Supabase docs:** https://supabase.com/docs
- **Next.js docs:** https://nextjs.org/docs
- **GitHub guides:** https://guides.github.com

Good luck! 🚀
