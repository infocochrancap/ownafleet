-- Migration 013: full status overhaul + lead_comments table
--
-- Two things in one migration:
--
-- 1) STATUS OVERHAUL
--    Replaces the old "new / contacted / application_sent / ..." chain with
--    a more precise sequence that mirrors the actual underwriting flow.
--    Each new status has a parenthetical description visible in the UI so
--    everyone (Josh + operators + referrers) understands what each step means.
--
--    submitted_homepage      — Form submitted via homepage
--    booked_call             — Booked Calendly call with Josh
--    call_completed_app_sent — Call completed; credit application link sent
--    application_submitted   — Received client's application for credit
--    incomplete_application  — Waiting for documentation/financials
--    credit_review           — With underwriting
--    in_progress             — Out with our lender marketplace
--    prelim_approved         — Preliminary term sheet, awaiting final
--    bank_approved           — Final approval, terms not yet accepted
--    closing                 — Final approval + terms accepted, closing
--    funded_enrolled         — Equipment funded and enrolled on the Armada platform
--
-- 2) LEAD COMMENTS / ACTIVITY FEED
--    New lead_comments table lets Josh + operators add free-form notes
--    against any lead, chronologically. Combined with lead_status_history
--    in the UI to form an activity feed visible to all admins.
--    Editable + soft-deletable (Slack-style).

-- ============================================================
-- PART 1: Status enum expansion + data migration
-- ============================================================

-- Step A: add the new enum values (must be in their own transaction in Postgres
-- before they can be used in UPDATE statements that follow).
alter type lead_status add value if not exists 'submitted_homepage';
alter type lead_status add value if not exists 'booked_call';
alter type lead_status add value if not exists 'call_completed_app_sent';
alter type lead_status add value if not exists 'application_submitted';
alter type lead_status add value if not exists 'incomplete_application';
alter type lead_status add value if not exists 'credit_review';
alter type lead_status add value if not exists 'in_progress';
alter type lead_status add value if not exists 'prelim_approved';
alter type lead_status add value if not exists 'bank_approved';
alter type lead_status add value if not exists 'closing';
alter type lead_status add value if not exists 'funded_enrolled';

-- !! STOP HERE on first run. Click Run, then come back and run PART 2 below
-- !! as a separate batch. Postgres requires the enum ADDs to commit before
-- !! the new values can be used in UPDATEs.


-- ============================================================
-- PART 2: data migration + lead_comments table
-- Run this as a SEPARATE batch AFTER Part 1 has committed.
-- ============================================================

-- Step B: migrate existing leads to the new status set.
-- (Safe to re-run — only updates rows that still have legacy values.)
update leads set status = 'submitted_homepage'      where status = 'new';
update leads set status = 'booked_call'             where status = 'contacted';
update leads set status = 'call_completed_app_sent' where status = 'application_sent';
update leads set status = 'application_submitted'   where status = 'mini_app_submitted';
update leads set status = 'credit_review'           where status = 'full_app_submitted';
update leads set status = 'bank_approved'           where status = 'approved';
update leads set status = 'closing'                 where status = 'terms_accepted';
update leads set status = 'funded_enrolled'         where status in ('funded', 'operating');
-- Pre-migration-006 legacy values too, in case any test data still has them.
update leads set status = 'application_submitted'   where status = 'application_started';
update leads set status = 'credit_review'           where status = 'documents_uploaded';
update leads set status = 'funded_enrolled'         where status = 'closed_won';

-- Step C: lead_comments table — the activity-feed substrate.
create table if not exists lead_comments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  comment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz                 -- soft-delete; UI hides these
);

create index if not exists lead_comments_lead_idx
  on lead_comments(lead_id, created_at desc)
  where deleted_at is null;

alter table lead_comments enable row level security;

-- All admins (owners + operators) can read comments on any lead.
create policy "Admins read all comments"
on lead_comments for select to authenticated
using (is_operator_or_owner(auth.uid()));

-- All admins can insert their own comments.
create policy "Admins insert comments"
on lead_comments for insert to authenticated
with check (
  is_operator_or_owner(auth.uid())
  and author_id = auth.uid()
);

-- An author can edit / soft-delete only their own comments.
-- (Owner has full access via the leads-table policies and the general admin
--  pattern, but we still scope edits to the author so attribution stays clean.)
create policy "Authors update own comments"
on lead_comments for update to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy "Authors delete own comments"
on lead_comments for delete to authenticated
using (author_id = auth.uid());
