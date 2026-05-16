-- ============================================================
-- Migration 003 — Deck gate + application_sent status
-- Run this in Supabase SQL Editor AFTER schema.sql and migration_002_roles.sql.
-- ============================================================

-- 1. Add application_sent to the lead_status enum (between contacted and application_started)
alter type lead_status add value if not exists 'application_sent' after 'contacted';

-- 2. New table: deck_requests
-- Tracks every email-gated deck request. Separate from leads because not every
-- deck request is a full lead — sometimes someone just wants to read the overview.
create table if not exists deck_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  email text not null,
  ip text,
  user_agent text,
  disclaimer_accepted boolean not null default false,
  -- If this person later submits the lead form, we link the records:
  lead_id uuid references leads(id) on delete set null
);

create index if not exists deck_requests_email_idx on deck_requests(email);
create index if not exists deck_requests_created_idx on deck_requests(created_at desc);

-- RLS — admins only
alter table deck_requests enable row level security;

drop policy if exists "Admins can read all deck requests" on deck_requests;
create policy "Admins can read all deck requests"
on deck_requests for select to authenticated
using (is_admin(auth.uid()));

-- Inserts come through the service-role API, no row-level grant needed for that path.
