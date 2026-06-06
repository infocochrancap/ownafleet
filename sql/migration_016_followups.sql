-- ============================================================
-- Migration 016 — Unified follow-up system
-- ============================================================
--
-- ONE follow-up engine. Replaces the old auto-drip emailer (cron-nudges) and
-- adds the relationship tracks Josh sets after a phone/text conversation.
-- Everything — funnel-stage nudges AND conversation tracks — flows through a
-- single Outbox (followup_drafts) with per-type send-mode control.
--
-- FOLLOW-UP TYPES (7):
--   Funnel-stage (auto-detected from website actions, one-shot — these are the
--   three the old cron-nudges sent; same copy):
--     no_book      — got the deck, never booked a call
--     no_app       — booked a call, no application yet
--     stalled_app  — application received but stalled (incomplete)
--   Conversation tracks (Josh sets these after talking; recurring, calendar-
--   aware so deals close before the Q4 rush):
--     interested_no_app — interested, hasn't completed the application
--     with_accountant   — figuring it out with their CPA
--     too_early         — too early in THEIR year
--     past_customer     — already bought; annual re-buy
--
-- SEND MODES (per type): 'draft' = queue in the Outbox for Josh to approve;
-- 'auto' = send on its own. Everything starts 'draft' — flip a type to 'auto'
-- once the copy is trusted.
--
-- HANDOFF (no duplicate emails ever): the funnel-stage auto-nudges only fire
-- for leads NOT on a conversation track (followup_track = 'none'). The moment
-- Josh puts someone on a track, the new system owns them.
--
-- Run the whole file in one batch in the Supabase SQL editor.

-- ----- ENUM: conversation tracks stored on the lead -----
do $$ begin
  create type followup_track as enum (
    'none',
    'interested_no_app',
    'with_accountant',
    'too_early',
    'past_customer'
  );
exception
  when duplicate_object then null;
end $$;

-- ----- LEAD COLUMNS (the conversation track + its schedule) -----
alter table leads
  add column if not exists followup_track    followup_track not null default 'none',
  add column if not exists next_followup_at   timestamptz,
  add column if not exists last_followup_at    timestamptz,
  add column if not exists followup_paused     boolean not null default false,
  add column if not exists followup_count      integer not null default 0;

create index if not exists leads_followup_due_idx
  on leads (next_followup_at)
  where followup_track <> 'none'
    and followup_paused = false
    and next_followup_at is not null;

-- NOTE: the funnel-stage one-shot stamps reuse the columns added in
-- migration 009 (deck_requests.nudge_no_book_sent_at / nudge_no_app_sent_at,
-- leads.nudge_stalled_sent_at) — no new stamp columns needed. The cron now
-- stamps them when it CREATES the draft (or auto-sends), so a funnel nudge is
-- still produced at most once per prospect.

-- ----- PER-TYPE SEND MODE (all 7 types) -----
create table if not exists followup_settings (
  followup_type text primary key,
  send_mode     text not null default 'draft' check (send_mode in ('draft','auto')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

insert into followup_settings (followup_type, send_mode) values
  ('no_book',           'draft'),
  ('no_app',            'draft'),
  ('stalled_app',       'draft'),
  ('interested_no_app', 'draft'),
  ('with_accountant',   'draft'),
  ('too_early',         'draft'),
  ('past_customer',     'draft')
on conflict (followup_type) do nothing;

alter table followup_settings enable row level security;

create policy "Admins read followup settings"
on followup_settings for select to authenticated
using (is_operator_or_owner(auth.uid()));

-- Only owners flip send modes (auto-send is a trust decision).
create policy "Owners manage followup settings"
on followup_settings for all to authenticated
using (is_owner(auth.uid()))
with check (is_owner(auth.uid()));

-- ----- OUTBOX / APPROVAL QUEUE (every type lands here in draft mode) -----
create table if not exists followup_drafts (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  followup_type text not null,            -- one of the 7 types above
  to_email      text not null,
  subject       text not null,
  body_html     text not null,
  calendar_context text,                  -- 'prime' | 'q3_urgent' | 'q4_defer' | 'pre_season'
  status        text not null default 'pending' check (status in ('pending','sent','skipped')),
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  sent_by       uuid references auth.users(id),
  skipped_at    timestamptz,
  skipped_by    uuid references auth.users(id)
);

create index if not exists followup_drafts_pending_idx
  on followup_drafts (created_at)
  where status = 'pending';

-- At most ONE pending draft per (lead, type) so the daily cron never stacks
-- duplicates while a draft awaits review.
create unique index if not exists followup_drafts_one_pending_idx
  on followup_drafts (lead_id, followup_type)
  where status = 'pending';

alter table followup_drafts enable row level security;

create policy "Admins manage followup drafts"
on followup_drafts for all to authenticated
using (is_operator_or_owner(auth.uid()))
with check (is_operator_or_owner(auth.uid()));

-- ----- INTERACTIONS: new source value for sent follow-ups -----
alter table prospect_interactions
  drop constraint if exists prospect_interactions_source_check;

alter table prospect_interactions
  add constraint prospect_interactions_source_check
  check (source in (
    'manual','email_bcc','ghl_sms','fathom','ios_shortcut','calendly','followup','other'
  ));
