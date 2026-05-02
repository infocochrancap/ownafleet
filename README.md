# OwnaFleet

Marketing site, lead capture, admin dashboard, and partner referral system for the equipment ownership program with Armada Fleet Management / EquipmentShare.

## Architecture

- **Static HTML pages** — no build step, no framework. Edit and refresh.
- **Vercel serverless functions** (`/api/*.js`) — for form submissions, email, and admin notifications.
- **Supabase** — database, auth (magic links), row-level security.
- **Resend** — transactional email.
- **Cloudflare** — domain registration + DNS.

## Local file structure

```
web/
├── index.html              Public marketing site + lead form
├── partners.html           Public partner program pitch + application
├── login.html              Magic-link sign-in (admin + partners)
├── thank-you.html          Lead form confirmation
├── admin.html              Lead + partner management (admin only)
├── dashboard.html          Partner's view of their referrals
├── api/
│   ├── submit-lead.js          POST — main lead form
│   ├── apply-partner.js        POST — partner application
│   └── notify-status-change.js POST — admin → partner email on status change
├── shared/
│   └── supabase.js         Browser Supabase client + role helper
├── public/assets/          Static images
├── sql/schema.sql          Database schema (run once in Supabase SQL Editor)
├── package.json            Declares Resend + Supabase deps for Vercel build
├── vercel.json             Deploy config + security headers
└── .gitignore
```

## Environment variables

These are set in Vercel project settings (and locally in `.env.local` if running `vercel dev`).

| Variable | Where it's used | Example |
|----------|-----------------|---------|
| `SUPABASE_URL` | API routes | `https://xxxx.supabase.co` |
| `SUPABASE_SECRET_KEY` | API routes | `sb_secret_xxxxx` |
| `RESEND_API_KEY` | API routes (email) | `re_xxxxx` |
| `LEAD_NOTIFY_EMAILS` | submit-lead — who gets new lead emails | `brian@..., alondra@..., josh@...` |
| `ADMIN_NOTIFY_EMAILS` | apply-partner — who gets new partner application emails | `josh@ownafleet.com` |

The browser-side Supabase URL and **publishable key** are hardcoded in `shared/supabase.js` (safe to expose — RLS enforces access).

## First-time setup

### 1. Run the database schema

In Supabase Dashboard → SQL Editor → paste the contents of `sql/schema.sql` → Run.

This creates: `leads`, `referral_partners`, `lead_status_history`, `admins` tables, plus all RLS policies and triggers.

### 2. Bootstrap admin accounts

After deploying the site (see below), each admin needs to:
1. Visit `/login` on the deployed site
2. Enter their email (e.g., `josh@ownafleet.com`)
3. Click the magic link in their email — this creates an `auth.users` row

Then, in Supabase SQL Editor, run **once per admin**:
```sql
insert into admins (user_id, email)
select id, email from auth.users where email = 'josh@ownafleet.com';
```

Repeat for `brian.duncan@bevelfinancial.com` and `alondra@bevelfinancial.com`.

After this, those users will be redirected to `/admin` when they sign in. Until then, the login page shows "account pending" for them.

### 3. Configure Supabase Auth

In Supabase Dashboard → Authentication → URL Configuration:
- **Site URL**: `https://ownafleet.com`
- **Redirect URLs**: add `https://ownafleet.com/login`

In Authentication → Email Templates, optionally customize the "Magic Link" template to match brand.

### 4. Configure Resend

In Resend Dashboard → Domains → Add Domain → enter `ownafleet.com`.

Resend will provide DNS records (SPF, DKIM) — add them in Cloudflare:
- Cloudflare → ownafleet.com → DNS → add the TXT/CNAME records Resend specifies
- Wait for propagation (usually < 10 min), then click "Verify" in Resend

Once verified, emails sending `from: leads@ownafleet.com` will be delivered properly.

## Deployment to Vercel

### Option A: Connect to GitHub (recommended)

1. Push this repo to GitHub (see git instructions below)
2. In Vercel Dashboard → Add New → Project → Import the GitHub repo
3. Vercel auto-detects the project. **Framework Preset**: "Other"
4. Add environment variables (see table above) under "Environment Variables"
5. Click Deploy
6. After first deploy, go to Project Settings → Domains → add `ownafleet.com` and `www.ownafleet.com`
7. Vercel shows DNS records to add at Cloudflare. Add them in Cloudflare → ownafleet.com → DNS

### Option B: Vercel CLI (if Node is installed)

```bash
cd web
npm install -g vercel
vercel login
vercel --prod
# Then add env vars in dashboard, link domain, etc.
```

## Day-to-day

- **Code edits**: push to GitHub. Vercel auto-deploys on push.
- **View leads**: log in at `/login` → redirected to `/admin`.
- **Approve partners**: `/admin?view=partners` → change status from "pending" to "active". Partner gets email notification (TODO — add separate "approve" email).
- **Update lead status**: from `/admin`, change the dropdown next to a lead. Partner is auto-emailed if attached.

## Status flow

```
new → contacted → application_started → documents_uploaded → approved → funded → closed_won
                                                                          ↓
                                                                        dead (any time)
```

## Auto-classification

Leads are tagged on insert:
- **hot** — meets all three lender criteria (equipment ≥ $500K, net worth ≥ $3M tier, liquidity ≥ $300K tier)
- **warm** — meets 2 of 3
- **needs_review** — has "Not sure" / "Under" values that need follow-up
- **unqualified** — clearly doesn't meet criteria

Edit the `classify_lead_qualification()` function in `sql/schema.sql` to tune thresholds.

## Compliance + content edits

All marketing copy is in `index.html` and `partners.html` — search for the section, edit, push. Brand styles use CSS custom properties at the top of each file (`--ink`, `--accent`, etc.) — change them in one place to retheme.

The disclaimer footer block is duplicated across pages — when updating, search for `Cochran Management LLC, a Wyoming limited liability` and update everywhere.
