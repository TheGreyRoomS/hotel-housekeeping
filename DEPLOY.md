# Hotel Housekeeping — Deployment Guide

## What's inside

```
hotel-housekeeping-server/
├── server.js          ← Express + PostgreSQL backend
├── package.json
├── Procfile           ← For Render
├── railway.toml       ← For Railway
├── render.yaml        ← For Render (optional one-click)
├── .env.example       ← Copy to .env for local use
└── public/
    └── index.html     ← The web app (served by Express)
```

---

## Option A — Deploy to Railway (recommended)

1. Go to [railway.app](https://railway.app) and log in
2. Click **New Project → Deploy from GitHub repo**
   - Push this folder to a GitHub repo first, OR use **Deploy from local** and drag the folder in
3. Once the project is created, click **+ New** → **Database** → **PostgreSQL**
   - Railway auto-creates a `DATABASE_URL` variable and links it to your app
4. Go to your web service → **Variables** tab → add:
   - `JWT_SECRET` = any long random string (e.g. `hotel2024XYZsecretKey!`)
5. Click **Deploy** — Railway builds and starts the server
6. After deploy, click **Settings → Domains** → generate a public URL
7. Share that URL with all staff — done!

---

## Option B — Deploy to Render

### Using the Dashboard (easiest)

1. Go to [render.com](https://render.com) and log in
2. **Create a PostgreSQL database first:**
   - New → PostgreSQL → name it `hotel-housekeeping-db` → Create
   - Copy the **Internal Database URL** from the database page
3. **Create a Web Service:**
   - New → Web Service → connect your GitHub repo (push this folder first)
   - Build Command: `npm install`
   - Start Command: `node server.js`
4. Add Environment Variables:
   - `DATABASE_URL` = paste the Internal Database URL from step 2
   - `JWT_SECRET`   = any long random string
5. Click **Create Web Service**
6. Once deployed, your URL appears at the top — share it with staff

### Using render.yaml (one-click)

If you push this folder to GitHub, Render can auto-configure everything:
1. New → Blueprint → connect repo → Render reads `render.yaml` automatically

---

## Local development (optional)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env: set DATABASE_URL to your local PostgreSQL connection string

# 3. Run (with auto-restart on file changes)
npm run dev

# 4. Open http://localhost:3000
```

You need PostgreSQL installed locally, or use a free cloud database like Supabase/Neon for local dev.

---

## Demo accounts (pre-loaded on first run)

| Username     | Password  | Role         |
|-------------|-----------|--------------|
| admin        | admin123  | Admin        |
| reception1   | pass123   | Reception    |
| reception2   | pass123   | Reception    |
| hk1          | pass123   | Housekeeper  |
| hk2          | pass123   | Housekeeper  |
| hk3          | pass123   | Housekeeper  |
| maintenance  | pass123   | Maintenance  |

**Change these passwords** via the Admin panel after first login!

---

## Adding more staff

Log in as `admin` → click **⚙️ Users** tab → **+ Add User**

---

## Notes

- Photos are stored as base64 in the database. For a very large hotel or heavy photo use, consider upgrading to cloud storage (S3/Cloudflare R2) later.
- All staff devices sync every 25 seconds automatically.
- The app works on PC and tablets in any modern browser.
