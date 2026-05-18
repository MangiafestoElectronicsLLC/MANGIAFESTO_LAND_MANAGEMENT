# GitHub Setup Guide

Simple steps to push your app to GitHub for the first time.

---

## 1. Create a GitHub Account

1. Go to [github.com](https://github.com)
2. Click **Sign up**
3. Enter your email
4. Create a password
5. Choose a username (this will be in your app URL)
6. Complete the verification
7. Done!

---

## 2. Create a New Repository

1. Go to [github.com/new](https://github.com/new)
2. For **Repository name**, enter: `family-land-board`
3. Add **Description** (optional): "Family land management app"
4. Keep it **Private** if you want only family to see it
5. Do NOT check "Add a README file" (you already have one)
6. Click **Create repository**

---

## 3. Push Your Code to GitHub

Open **Command Prompt** in your project folder and copy-paste these commands one at a time (press Enter after each):

```bash
git init
git add .
git commit -m "Initial commit: Family Land Board"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/family-land-board.git
git push -u origin main
```

**Replace `YOUR_USERNAME` with your actual GitHub username!**

If prompted for a password, use your GitHub password (or create a Personal Access Token in GitHub Settings).

---

## 4. Verify It Worked

1. Go to https://github.com/YOUR_USERNAME/family-land-board
2. You should see all your files there
3. Success! 🎉

---

## Making Updates

After editing your app, push changes with:

```bash
git add .
git commit -m "Your change description here"
git push
```

For example:
```bash
git commit -m "Add role filtering to tickets"
```

---

## Sharing with Your Family

Send them this link:
```
https://github.com/YOUR_USERNAME/family-land-board
```

They can click **Code** → **Download ZIP** to download it, or clone it with:
```bash
git clone https://github.com/YOUR_USERNAME/family-land-board.git
```

---

## Troubleshooting

| Error | Solution |
|-------|----------|
| "fatal: not a git repository" | Make sure you're in the `family-land-board` folder |
| "Permission denied" | Use your GitHub password or create a Personal Access Token |
| "rejected... tip of your current branch is behind" | Run `git pull origin main` first |

---

## Next: Deploy to Vercel

Once your code is on GitHub, see **DEPLOYMENT_GUIDE.md** to deploy live!
