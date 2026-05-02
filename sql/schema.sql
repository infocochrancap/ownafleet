-- ============================================================
-- OwnaFleet — Database schema
-- Run this once in Supabase SQL Editor.
-- ============================================================

-- ----- ENUMS -----
create type lead_status as enum (
  'new',
  'contacted',
  'application_started',
  'documents_uploaded',
  'approved',
  'funded',
  'closed_won',
  'dead'
);

create type partner_status as enum (
  'pending',
  'active',
  'paused',
  'rejected'
);

create type qualification_tier as enum (
  'hot',
  'warm',
  'needs_review',
  'unqualified'
);

-- ----- REFERRAL PARTNERS -----
create table referral_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  email text unique not null,
  first_name text not null,
  last_name text not null,
  company text,
  phone text,
  commission_split_pct numeric(5,2) not null default 40.00,  -- partner's %; josh keeps 100 - this
  referral_code text unique not null,
  status partner_status not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id)
);

create index referral_partners_status_idx on referral_partners(status);
create index referral_partners_code_idx on referral_partners(referral_code);

-- ----- LEADS -----
create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Lead contact info
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  state text not null,

  -- Qualification info
  equipment_range text not null,
  net_worth text not null,
  liquidity text not null,
  notes text,

  -- Auto-classified
  qualification qualification_tier not null default 'needs_review',

  -- Pipeline status
  status lead_status not null default 'new',
  status_updated_at timestamptz not null default now(),
  status_updated_by uuid references auth.users(id),

  -- Referral attribution
  referral_partner_id uuid references referral_partners(id) on delete set null,
  referral_source text,  -- e.g., 'direct', 'partner:abc123', utm_source value

  -- Estimated commission (for partner visibility on closed deals)
  estimated_equipment_value numeric(14,2),
  estimated_total_commission numeric(12,2),

  -- Internal admin notes (never shown to partners)
  internal_notes text
);

create index leads_status_idx on leads(status);
create index leads_partner_idx on leads(referral_partner_id);
create index leads_created_idx on leads(created_at desc);

-- ----- LEAD STATUS HISTORY -----
create table lead_status_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  from_status lead_status,
  to_status lead_status not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id),
  note text
);

create index lead_status_history_lead_idx on lead_status_history(lead_id, changed_at desc);

-- ----- ADMINS -----
-- Simple admin table — explicitly listed admins can see everything
create table admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Track status changes automatically
create or replace function record_lead_status_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into lead_status_history (lead_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, new.status_updated_by);
    new.status_updated_at = now();
  end if;
  return new;
end;
$$;

create trigger leads_status_change_trigger
before update on leads
for each row execute function record_lead_status_change();

-- Auto-classify qualification on insert
create or replace function classify_lead_qualification()
returns trigger language plpgsql as $$
declare
  meets_networth boolean;
  meets_liquidity boolean;
  meets_equipment boolean;
begin
  -- Hot = meets all three lender criteria
  meets_equipment := new.equipment_range in ('$500K – $1M','$1M – $2M','$2M – $5M','$5M – $10M','$10M – $25M','$25M – $50M','$50M+');
  meets_networth  := new.net_worth in ('$3M – $10M','$10M – $30M','$30M – $75M','$75M – $150M','$150M+');
  meets_liquidity := new.liquidity in ('$300K – $1M','$1M – $3M','$3M – $10M','$10M – $25M','$25M+');

  if meets_equipment and meets_networth and meets_liquidity then
    new.qualification := 'hot';
  elsif (meets_equipment::int + meets_networth::int + meets_liquidity::int) >= 2 then
    new.qualification := 'warm';
  elsif new.equipment_range = 'Not sure yet' or new.net_worth = 'Under $1M' or new.liquidity = 'Under $300K' then
    new.qualification := 'needs_review';
  else
    new.qualification := 'unqualified';
  end if;

  return new;
end;
$$;

create trigger leads_classify_trigger
before insert on leads
for each row execute function classify_lead_qualification();

-- ============================================================
-- HELPERS
-- ============================================================

create or replace function is_admin(uid uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from admins where user_id = uid);
$$;

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

alter table leads enable row level security;
alter table referral_partners enable row level security;
alter table lead_status_history enable row level security;
alter table admins enable row level security;

-- LEADS policies
-- Admins see all
create policy "Admins can do anything on leads"
on leads for all to authenticated
using (is_admin(auth.uid()))
with check (is_admin(auth.uid()));

-- Partners see only their own leads
create policy "Partners can read their own leads"
on leads for select to authenticated
using (
  referral_partner_id in (
    select id from referral_partners where user_id = auth.uid()
  )
);

-- REFERRAL_PARTNERS policies
-- Admins manage all
create policy "Admins can manage all referral partners"
on referral_partners for all to authenticated
using (is_admin(auth.uid()))
with check (is_admin(auth.uid()));

-- Partner can read/update own profile
create policy "Partners can read own profile"
on referral_partners for select to authenticated
using (user_id = auth.uid());

create policy "Partners can update own profile (limited fields)"
on referral_partners for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and status = (select status from referral_partners where user_id = auth.uid()));
-- ^ partner cannot change their own status (e.g., approve themselves)

-- LEAD_STATUS_HISTORY policies
create policy "Admins can read all status history"
on lead_status_history for select to authenticated
using (is_admin(auth.uid()));

create policy "Partners can read history for their own leads"
on lead_status_history for select to authenticated
using (
  lead_id in (
    select id from leads where referral_partner_id in (
      select id from referral_partners where user_id = auth.uid()
    )
  )
);

-- ADMINS table — only admins can see who admins are
create policy "Admins can read admin list"
on admins for select to authenticated
using (is_admin(auth.uid()));

-- ============================================================
-- BOOTSTRAP — SET YOUR ADMIN EMAIL HERE BEFORE RUNNING
-- ============================================================
-- After running schema, manually run:
--   1. Sign up at /login on the site with josh@ownafleet.com (creates auth.users row)
--   2. Then run:
--      insert into admins (user_id, email)
--      select id, email from auth.users where email = 'josh@ownafleet.com';
--   3. Repeat for brian.duncan@bevelfinancial.com, alondra@bevelfinancial.com
