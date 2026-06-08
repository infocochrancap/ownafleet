# OwnaFleet

Marketing site, lead capture, admin dashboard, partner referral system, and
deck delivery for the equipment ownership program with Armada Fleet Management
/ EquipmentShare.

## Architecture

- **Static HTML pages** — no build step, no framework. Edit and refresh.
- **Vercel serverless functions** (`/api/*.js`) — for form submissions, email,
  admin notifications, and the Calendly booking webhook.
- **Supabase** — Postgres database, auth (magic links), row-level security.
- **Resend** — transactional email (`leads@ownafleet.com` sender).
- **Cloudflare** — domain registration, DNS, and Email Routing (forwards
  `josh@ownafleet.com` → personal inbox; pipes `log@ownafleet.com` to a
  Worker that logs inbound BCC mail into Supabase as interactions).
- **Calendly** — booking widget on `/welcome`, plus `invitee.created` webhook
  that auto-promotes lead status on book.
- **Meta Pixel + Vercel Analytics** — scaffolded; Pixel needs the real ID
  before ads can fire `Lead` / `Schedule` conversion events.

## File structure

```
web/
├── index.html              Public marketing site (hero, math calculator, form)
├── welcome.html            Step 2/3 booking page (Calendly embed + deck unlock)
├── partners.html           Public partner-program pitch + application form
├── apply.html              Standalone Jotform-embed application page
├── login.html              Magic-link sign-in (admin + partners)
├── thank-you.html          Lead-form confirmation
├── admin.html              Lead + partner management (admin only)
├── dashboard.html          Partner's view of their referrals
├── deck/
│   ├── index.html          Deck index / entry redirect
│   ├── view.html           21-slide HTML overview (also iframe-embedded in /welcome)
│   └── assets/             cover.jpg, categories.jpg, closing.jpg, josh.jpg
├── api/
│   ├── _lib/
│   │   └── abuse-check.js          Honeypot + per-IP rate limit (shared)
│   ├── submit-lead.js              POST — main lead form (→ Supabase + emails)
│   ├── apply-partner.js            POST — partner application
│   ├── partner-add-referral.js     POST — logged-in partner adds a referral (auto-attributed)
│   ├── request-deck.js             POST — public deck request (legacy/fallback path)
│   ├── calendly-webhook.js         POST — invitee.created webhook (HMAC-verified)
│   ├── log-interaction.js          POST — Cloudflare Email Worker → log@ownafleet.com
│   ├── send-application.js         POST — admin sends Armada credit-app link (manual modal button)
│   ├── send-nudge.js               POST — admin sends manual one-off nudge (modal button)
│   ├── set-followup.js             POST — admin sets/clears a follow-up track on a lead
│   ├── send-followup.js            POST — admin approves (send) or skips an Outbox draft
│   ├── cron-followups.js           GET  — daily 16:00 UTC SINGLE follow-up engine (Vercel cron):
│   │                                       funnel-stage nudges + conversation tracks → Outbox
│   ├── notify-status-change.js     POST — admin status change → partner email
│   ├── notify-partner-approved.js  POST — partner approval email
│   ├── admin-add-partner.js        POST — admin tool: whitelist a partner
│   └── link-partner.js             POST — link a partner record to a lead
├── assets/
│   ├── favicon.svg                 Gold serif "O" on ink square
│   ├── og-image.jpg                1200×630 social card matching current hero
│   ├── hero-bg.jpg                 Golden-hour excavator + boom + forklift
│   ├── wordmark.html               Wordmark generator (transparent PNG export)
│   └── og-image-gen.html           OG card generator (regenerate when hero changes)
├── preview/
│   ├── hero-mockup.html            Working preview of /
│   └── welcome-mockup.html         Working preview of /welcome
├── cloudflare/
│   └── email-worker.js             Worker for log@ownafleet.com BCC capture
├── scripts/
│   ├── setup-calendly-webhook.js   One-time webhook registration
│   └── import-spreadsheet-leads.py Lead-import utility (legacy / one-off)
├── sql/
│   ├── schema.sql                  Initial schema
│   └── migration_001..016.sql      Sequential migrations (run in Supabase SQL Editor)
│                                    (016 = unified follow-up system)
├── shared/
│   └── supabase.js                 Browser Supabase client + role helper
├── public/assets/                  Static images (mirror of /assets in some paths)
├── package.json                    Resend + Supabase deps for Vercel build
├── vercel.json                     Deploy config, cleanUrls, security headers, cron
├── .env.example                    All env vars with descriptions
└── .gitignore
```

## Environment variables

See `.env.example` for the canonical list with descriptions. The short table:

| Variable | Used by | Notes |
|----------|---------|-------|
| `SUPABASE_URL` | All API routes | `https://lkfaemhhdxjaqggvlotv.supabase.co` |
| `SUPABASE_SECRET_KEY` | All API routes | Full DB access — server-side only |
| `RESEND_API_KEY` | All email-sending APIs | From Resend dashboard |
| `ADMIN_NOTIFY_EMAILS` | `apply-partner` | New partner-application emails |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | `calendly-webhook` | HMAC verification — generated by `scripts/setup-calendly-webhook.js` |
| `CRON_SECRET` | `cron-followups` | Bearer token for Vercel cron auth |
| `INTERACTION_LOG_API_KEY` | `log-interaction` | Bearer token paired with Cloudflare Worker |
| `ARMADA_APPLICATION_URL` | `send-application` | The current credit-app link from operations |

`LEAD_NOTIFY_EMAILS` is **deprecated** — `/api/submit-lead` hardcodes Josh as the sole notification recipient. Brian + Alondra get engaged later in the funnel.

Browser-side Supabase URL + **publishable** key are hardcoded in `shared/supabase.js` (safe to expose — RLS enforces access).

## First-time setup

### 1. Run the database migrations

In Supabase Dashboard → SQL Editor → paste `sql/schema.sql` → Run, then run each migration in `sql/migration_001..015.sql` **in order**. Some migrations (notably 013, the status overhaul) require splitting into two batches — read the SQL comments before running.

This creates: `leads`, `referral_partners`, `lead_status_history`, `lead_comments`, `deck_requests`, `prospect_interactions`, `drip_nudges`, `admins`, and all RLS policies + triggers.

### 2. Bootstrap admin accounts

After deploying the site (see below), each admin needs to:
1. Visit `/login` on the deployed site
2. Enter their email (e.g., `josh@ownafleet.com`)
3. Click the magic link in email — this creates an `auth.users` row

Then, in Supabase SQL Editor, run **once per admin** with the appropriate role:

```sql
-- Josh (owner — full access):
insert into admins (user_id, email, role)
select id, email, 'owner'
from auth.users where email = 'josh@ownafleet.com';

-- Brian (operator — view all + update status/values; no internal notes; no partner mgmt):
insert into admins (user_id, email, role)
select id, email, 'operator'
from auth.users where email = 'brian@armadaequipment.com';
```

### 3. Configure Supabase Auth

- **Site URL**: `https://ownafleet.com`
- **Redirect URLs**: add `https://ownafleet.com/login` and the wildcard
  `https://ownafleet-*-cochran-capitals-projects.vercel.app/**` so magic
  links work on Vercel preview deployments

### 4. Configure Resend

In Resend Dashboard → Domains → Add Domain → enter `ownafleet.com`. Add the SPF + DKIM records in Cloudflare DNS. Verify in Resend. Emails sending `from: leads@ownafleet.com` will deliver.

### 5. Register the Calendly webhook (one-time)

```bash
cd web
CALENDLY_API_TOKEN=<personal-access-token> node scripts/setup-calendly-webhook.js
```

The script prints a `CALENDLY_WEBHOOK_SIGNING_KEY` — add it to Vercel env vars, then revoke the API token in Calendly (you only need it once).

## Deployment

### Preview-first workflow (default)

Never go straight to `--prod` unless it's a trivial fix (typo, single-word swap).

```bash
cd web

# 1. Make all your edits for the cycle
# 2. Commit + push
git add . && git commit -m "..." && git push

# 3. Preview deploy (unique URL, doesn't touch ownafleet.com)
npx vercel
# → outputs https://ownafleet-xxxxx-cochran-capitals-projects.vercel.app

# 4. After review, promote to production
npx vercel --prod --yes
```

GitHub auto-deploy to Vercel is **NOT wired up** (team-account vs personal-GitHub mismatch). All deploys go through the CLI above.

## Day-to-day operations

- **View leads**: log in at `/login` → `/admin`. The pipeline view shows all leads grouped by status with the activity feed (status history + comments) per lead.
- **Update lead status**: dropdown in `/admin`. If the lead has a referral partner attached, that partner is auto-emailed on the change.
- **Approve partners**: `/admin?view=partners` → change status from "pending" to "active". Partner receives an approval email with a sign-in link.
- **View interactions**: `/admin?view=interactions` shows all logged interactions (Calendly bookings, BCC'd emails to `log@ownafleet.com`, manual entries).
- **Send credit-app link**: from `/admin` lead detail view, click "Send application" — uses `ARMADA_APPLICATION_URL` env var.

## Lead status flow (post-migration 013)

```
submitted_homepage      Form submitted via homepage
  ↓
booked_call             Booked Calendly call (auto via webhook)
  ↓
call_completed_app_sent Call completed; Armada credit-app link sent
  ↓
application_submitted   Received client's application
  ↓
incomplete_application  Waiting on docs/financials  (can loop back)
  ↓
credit_review           With underwriting
  ↓
in_progress             Out with lender marketplace
  ↓
prelim_approved         Preliminary term sheet, awaiting final
  ↓
bank_approved           Final approval, terms not yet accepted
  ↓
closing                 Approval + terms accepted, closing in progress
  ↓
funded_enrolled         Funded + enrolled on Armada platform (terminal)

(any stage → not_now / archived for stalled or dropped leads)
```

The Calendly webhook auto-promotes `submitted_homepage → booked_call` only when matching by email — it never moves a lead backward.

## Anti-bypass content rules

Customer-facing surfaces (`index.html`, `welcome.html`, `partners.html`, `apply.html`, `thank-you.html`, `deck/view.html`, lead/prep emails) **must not name** Armada, EquipmentShare, Bevel, or Brian Duncan. Use generic descriptors:

| Don't say | Say instead |
|-----------|-------------|
| EquipmentShare | "the operating partner" / "our operating partner" / "the rental network" |
| Armada / Armada Fleet Management | "our fleet management partner" / "the partner team" |
| Bevel / Bevel Financial | "our lending partner" |
| Brian Duncan | "the partner team" (or drop entirely) |

**Strategy**: if visitors can't Google our partner names, the only path is through Josh's form. Internal pages (`admin.html`, `dashboard.html`), code comments, and SQL files can still use the real names.

## Compliance disclosure

Synced across `index.html`, `preview/hero-mockup.html`, and `deck/view.html`:

> *Disclosure: Josh is not a financial, tax, or legal advisor. He participates in the program himself and works directly with the operations team, helping refine the participant experience. He is compensated on completed deals — at no additional cost to you.*

If you edit one, edit all three. Voice consistency matters and the legal substance (FTC material-connection disclosure under 16 CFR Part 255) must remain intact.

## Funnel attribution

`/api/submit-lead` accepts a client-supplied `import_source` field. The homepage captures `utm_source/medium/campaign/content/term` and `ref` from the URL on landing, stores in sessionStorage, and ships with the form payload:

- Partner referrals: `?ref=<partner-code>` → matches `referral_partners.referral_code`
- Channel attribution: `?utm_source=linkedin&utm_campaign=dental-jun26` → stamped on `leads.import_source` as `utm:linkedin/cpc/dental-jun26`

Internal lead-notification email shows the SOURCE row at lead-creation time.

## Abuse protection

All public-form APIs (`submit-lead`, `request-deck`, `apply-partner`) use `api/_lib/abuse-check.js` for two layers:

1. **Honeypot field** (`name="website"`) — hidden from humans, auto-filled by bots. Server returns silent 200 on hit so bots don't retry.
2. **Per-IP rate limit** — 5 requests / 10-minute window. In-memory (best-effort against single-source bursts; not bulletproof against distributed attacks).

For distributed-attack protection, layer Cloudflare WAF rate-limit rules at the CDN edge (free tier supports basic rules).

## Useful one-liners

```bash
# Regenerate OG image when hero copy changes
open "https://ownafleet.com/assets/og-image-gen"
# Then download PNG, optimize, replace:
sips -s format jpeg -s formatOptions 85 -Z 1200 ~/Downloads/og-image.png \
  --out assets/og-image.jpg

# Bust social-image cache after replacing og-image.jpg
open "https://developers.facebook.com/tools/debug/?q=https://ownafleet.com"
open "https://www.linkedin.com/post-inspector/inspect/https%3A%2F%2Fownafleet.com"

# Check Vercel env vars
npx vercel env ls

# View recent deployments
npx vercel ls
```
