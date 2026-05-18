-- Migration 010: prospect_interactions log
--
-- The "what touched whom and when" table. Captures every touchpoint with a
-- prospect — email, text, phone, video call, in-person — so we have a record
-- of warm intros + outreach even when the prospect hasn't taken a website
-- action yet. Cross-references with deck_requests + leads to compute live
-- engagement status per prospect.
--
-- Populated by:
--   - Manual entry via /admin?view=interactions (source = 'manual')
--   - Cloudflare Email Worker on log@ownafleet.com (source = 'email_bcc')
--   - GoHighLevel SMS webhook                     (source = 'ghl_sms')  -- future
--   - Fathom meeting webhook                      (source = 'fathom')   -- future
--   - iOS Shortcut for personal phone             (source = 'ios_shortcut') -- future

create table prospect_interactions (
  id uuid primary key default gen_random_uuid(),

  -- Identity — at least one of email/phone should be set
  first_name text,
  last_name  text,
  email      text,
  phone      text,

  -- The touchpoint
  direction  text not null check (direction in ('inbound', 'outbound')),
  method     text not null check (method in (
    'email','text','phone','video_call','linkedin','in_person','other'
  )),
  subject    text,  -- e.g. email subject line, or short label
  notes      text,  -- body excerpt, free-form notes

  -- External system refs (so we can dedupe / link back)
  external_id  text, -- e.g. fathom meeting id, message-id, ghl conversation id
  external_url text, -- e.g. link to fathom recording, ghl conversation

  -- Provenance
  source     text not null default 'manual' check (source in (
    'manual','email_bcc','ghl_sms','fathom','ios_shortcut','other'
  )),
  logged_by  uuid references auth.users(id),
  logged_at  timestamptz not null default now(),

  -- Optional referral context
  referral_source text
);

-- Dedupe protection: same external_id from same source should only land once
create unique index prospect_interactions_external_idx
  on prospect_interactions(source, external_id)
  where external_id is not null;

create index prospect_interactions_email_idx
  on prospect_interactions(lower(email))
  where email is not null;

create index prospect_interactions_phone_idx
  on prospect_interactions(phone)
  where phone is not null;

create index prospect_interactions_logged_at_idx
  on prospect_interactions(logged_at desc);

alter table prospect_interactions enable row level security;

-- Admins (owners + operators) can manage everything
create policy "Admins manage prospect interactions"
on prospect_interactions for all to authenticated
using (is_operator_or_owner(auth.uid()))
with check (is_operator_or_owner(auth.uid()));
