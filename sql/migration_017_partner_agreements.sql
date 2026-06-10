-- Migration 017 — Partner agreement e-sign (click-wrap)
-- Adds a durable signed-agreement record per partner + quick-lookup stamps on
-- referral_partners. Activation flow: admin approves -> partner signs the
-- referral agreement at /agreement -> referral link + dashboard tools unlock.
--
-- Run in Supabase SQL editor:
-- https://supabase.com/dashboard/project/lkfaemhhdxjaqggvlotv/sql/new

-- ----- Signed-agreement audit records -----
create table if not exists partner_agreements (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references referral_partners(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,

  agreement_version text not null,          -- e.g. '2026-06-10.1'
  signed_name text not null,                -- typed full legal name
  signed_entity text,                       -- optional entity the signer represents
  fee_pct numeric(6,4) not null,            -- effective referral fee % rendered into the signed text
  assent boolean not null default true,     -- explicit checkbox assent

  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  doc_hash text not null,                   -- sha256 of the exact rendered agreement text assented to

  created_at timestamptz not null default now()
);

create index if not exists partner_agreements_partner_idx on partner_agreements(partner_id);
-- One signature per partner per version (re-signing only on a new version)
create unique index if not exists partner_agreements_partner_version_idx
  on partner_agreements(partner_id, agreement_version);

-- ----- Quick-lookup stamps on the partner row -----
alter table referral_partners add column if not exists agreement_signed_at timestamptz;
alter table referral_partners add column if not exists agreement_version text;

-- ----- RLS -----
alter table partner_agreements enable row level security;

-- Partners can read their own signed agreements (dashboard "signed on ..." line)
drop policy if exists partner_agreements_own_select on partner_agreements;
create policy partner_agreements_own_select
on partner_agreements for select to authenticated
using (
  partner_id in (select id from referral_partners where user_id = auth.uid())
);

-- Admins can read all
drop policy if exists partner_agreements_admin_select on partner_agreements;
create policy partner_agreements_admin_select
on partner_agreements for select to authenticated
using (
  exists (select 1 from admins where admins.user_id = auth.uid())
);

-- Inserts happen only via the service key in /api/sign-agreement (no
-- authenticated-role insert policy on purpose — keeps the audit record
-- tamper-proof: server verifies the session, renders the text, hashes it).
