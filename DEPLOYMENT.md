# Deployment guide — getting OwnaFleet live

Specific to Josh's setup. Follow in order.

---

## Step 1 — Run the database schema (5 min)

If you haven't already:

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → OwnaFleet project
2. Left sidebar → **SQL Editor** → **New query**
3. Open `web/sql/schema.sql` in a text editor, copy everything
4. Paste into Supabase SQL Editor → click **Run**
5. Should see "Success. No rows returned." ✓

---

## Step 2 — Push code to GitHub (10 min)

You'll need a **Personal Access Token (PAT)** for git to authenticate.

### 2a. Create a PAT
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Note: `OwnaFleet local push`
4. Expiration: **90 days** (or longer if you prefer)
5. Scopes: check **`repo`** (full control of private repositories)
6. Scroll down → **Generate token**
7. **Copy the token** (starts with `ghp_...`) — it's only shown once. Save it in your password manager.

### 2b. Push the code
Tell Claude the PAT and Claude will run the git push from this terminal. Claude will configure git with your name + email and your PAT, init the repo, and push.

(Or if you'd rather do it yourself, the commands are in the appendix below.)

---

## Step 3 — Connect GitHub to Vercel (5 min)

1. Log in at [vercel.com](https://vercel.com) (with `info@cochrancap.com`)
2. Top right → **Add New** → **Project**
3. **Import Git Repository** → find `infocochrancap/ownafleet` → click **Import**
4. **Configure Project:**
   - Framework Preset: **Other**
   - Root Directory: `web` (since the code lives in /web)
   - Build Command: leave blank
   - Output Directory: leave blank
5. **Environment Variables** — add each of these (paste from `.env.local` file in Equipment/Site/):
   - `SUPABASE_URL` → `https://lkfaemhhdxjaqggvlotv.supabase.co`
   - `SUPABASE_SECRET_KEY` → (the `sb_secret_...` value)
   - `RESEND_API_KEY` → (the `re_...` value)
   - `LEAD_NOTIFY_EMAILS` → `brian.duncan@bevelfinancial.com,alondra@bevelfinancial.com,josh@ownafleet.com`
   - `ADMIN_NOTIFY_EMAILS` → `josh@ownafleet.com`
6. Click **Deploy**
7. Wait ~1 min — you'll get a URL like `ownafleet-xyz.vercel.app`. Click it to see the live site.

**Test the form** with a fake submission to make sure leads land in Supabase + emails arrive.

---

## Step 4 — Connect ownafleet.com domain (10 min)

### 4a. In Vercel
1. Project → **Settings** → **Domains**
2. Add: `ownafleet.com` and `www.ownafleet.com`
3. Vercel shows DNS records to add at Cloudflare. Note them.

### 4b. In Cloudflare
1. [dash.cloudflare.com](https://dash.cloudflare.com) → ownafleet.com → **DNS** → **Records**
2. Add the records Vercel specified (typically an A record for root + CNAME for www)
3. Make sure proxy is **DNS only** (gray cloud, not orange) for both — Vercel handles SSL itself
4. Wait 1–5 min for DNS to propagate

After propagation, https://ownafleet.com loads the live site. SSL cert is automatic.

---

## Step 5 — Verify Resend domain for email (10 min)

1. [resend.com](https://resend.com) → **Domains** → **Add Domain** → enter `ownafleet.com`
2. Resend shows DNS records (SPF, DKIM, MX optional)
3. Add them in Cloudflare DNS (proxy off / DNS only)
4. Click **Verify** in Resend after 5 min

Until verified, emails will fail to send from `leads@ownafleet.com`. After verification, all good.

---

## Step 6 — Bootstrap admin accounts (5 min)

1. Visit `https://ownafleet.com/login`
2. Enter `josh@ownafleet.com` → click sign-in link in email
3. You'll see "Account pending" — that's normal, you're not an admin yet
4. In Supabase → SQL Editor, run:
   ```sql
   insert into admins (user_id, email)
   select id, email from auth.users where email = 'josh@ownafleet.com';
   ```
5. Sign in again — you're now redirected to `/admin`

Repeat steps 2 + 4 for `brian.duncan@bevelfinancial.com` and `alondra@bevelfinancial.com`.

---

## Step 7 — Final test

1. From a different browser / incognito tab, visit `https://ownafleet.com`
2. Submit the lead form with fake info
3. Verify:
   - You land on `/thank-you`
   - Lead shows up in `/admin`
   - Brian, Alondra, and Josh all receive notification emails
   - The lead receives a confirmation email
4. Submit a partner application at `/partners`
5. Approve them in `/admin?view=partners` — change status to "active"
6. Send the partner the magic link manually (until we automate the approval email)

---

## Going live

Once tests pass, you're live. Email Brian for compliance review of the public copy. Adjust per his feedback. Push changes to GitHub → Vercel auto-deploys.

---

## Appendix: manual git commands (if doing it yourself)

```bash
cd "/Users/joshcochran/Library/Mobile Documents/com~apple~CloudDocs/Claude/Equipment/Site/web"
git init
git config user.name "Josh Cochran"
git config user.email "info@cochrancap.com"
git add .
git commit -m "Initial commit — OwnaFleet v1"
git branch -M main
git remote add origin https://github.com/infocochrancap/ownafleet.git
git push -u origin main
# When prompted: username = infocochrancap, password = your PAT (starts with ghp_)
```
