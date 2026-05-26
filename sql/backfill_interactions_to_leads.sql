-- One-time backfill: create leads rows for every prospect_interactions
-- whose email doesn't already exist in leads.
--
-- Why this is needed:
--   Until 2026-05-26, /api/log-interaction wrote into prospect_interactions
--   but didn't auto-create a leads row. Manually-logged outbound conversations
--   (e.g., Ross Brenner, Brandon Johnson on 5/26) ended up on the Interactions
--   tab but invisible on the Leads tab. The API now auto-creates a lead on
--   manual interaction insert — this catches up anyone logged before that fix.
--
-- Safety:
--   - Uses DISTINCT ON to pick one row per unique email (earliest by created_at)
--   - Skips emails already in leads (case-insensitive match)
--   - Skips system-generated interactions (source = 'calendly') because those
--     already have lead rows linked via the Calendly webhook
--   - Drops in `import_source: 'manual_interaction_backfill'` so these rows
--     are distinguishable from forward-going manual interactions if ever needed
--
-- Run this once in Supabase SQL Editor, then never again.

insert into leads (first_name, last_name, email, phone, status, import_source)
select distinct on (lower(pi.email))
  coalesce(nullif(trim(pi.first_name), ''), 'Unknown'),
  coalesce(nullif(trim(pi.last_name), ''), ''),
  lower(trim(pi.email)),
  coalesce(nullif(trim(pi.phone), ''), ''),
  'submitted_homepage'::lead_status,
  'manual_interaction_backfill'
from prospect_interactions pi
where pi.email is not null
  and pi.source = 'manual'
  and lower(trim(pi.email)) not in (
    select lower(trim(email)) from leads where email is not null
  )
order by lower(pi.email), pi.logged_at asc;

-- Verify
select count(*) as new_leads_created
from leads
where import_source = 'manual_interaction_backfill';
