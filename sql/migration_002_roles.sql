-- ============================================================
-- Migration 002 — Add operator role to admins table
-- Run this once in Supabase SQL Editor.
-- ============================================================

-- ----- ENUM -----
create type admin_role as enum ('owner', 'operator');

-- ----- ADD COLUMN -----
alter table admins
  add column if not exists role admin_role not null default 'operator';

-- Set Josh as owner (full access)
update admins set role = 'owner' where email = 'josh@cochrancap.com';

-- ----- HELPERS -----
create or replace function is_owner(uid uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from admins where user_id = uid and role = 'owner');
$$;

create or replace function is_operator_or_owner(uid uuid)
returns boolean language sql security definer stable as $$
  select exists (select 1 from admins where user_id = uid);
$$;

-- ----- REPLACE LEAD POLICIES -----
-- Drop the existing "do anything" admin policy
drop policy if exists "Admins can do anything on leads" on leads;

-- Owners (Josh): full control
create policy "Owners full access on leads"
on leads for all to authenticated
using (is_owner(auth.uid()))
with check (is_owner(auth.uid()));

-- Operators (Brian, Alondra): SELECT all leads, but UPDATE only specific columns
-- (Postgres RLS doesn't support per-column updates directly, so we enforce
--  it in the app layer too — but RLS allows the update to happen.)
create policy "Operators can read all leads"
on leads for select to authenticated
using (is_operator_or_owner(auth.uid()));

create policy "Operators can update leads"
on leads for update to authenticated
using (is_operator_or_owner(auth.uid()))
with check (is_operator_or_owner(auth.uid()));

-- Block operators from deleting leads (only owners can)
-- (Already handled — only the "Owners full access" policy allows DELETE)

-- ----- COLUMN-LEVEL: revoke direct access to internal_notes for non-owners -----
-- We can't fully prevent SELECT on a single column via RLS, but we can hide
-- it in the UI. Operators who SELECT will still see internal_notes — handled by app.
-- For UPDATE, we use a trigger to reject changes to forbidden columns by operators:

create or replace function enforce_operator_column_restrictions()
returns trigger language plpgsql as $$
declare
  caller_role admin_role;
begin
  select role into caller_role from admins where user_id = auth.uid();

  -- Owners can do anything; if not an admin at all, RLS already blocked us
  if caller_role = 'owner' or caller_role is null then
    return new;
  end if;

  -- Operators can ONLY change: status, status_updated_by, status_updated_at,
  -- estimated_equipment_value, estimated_total_commission
  -- Anything else is a no-op (revert to old value)
  new.first_name := old.first_name;
  new.last_name := old.last_name;
  new.email := old.email;
  new.phone := old.phone;
  new.state := old.state;
  new.equipment_range := old.equipment_range;
  new.net_worth := old.net_worth;
  new.liquidity := old.liquidity;
  new.notes := old.notes;
  new.qualification := old.qualification;
  new.referral_partner_id := old.referral_partner_id;
  new.referral_source := old.referral_source;
  new.internal_notes := old.internal_notes;  -- protected
  new.created_at := old.created_at;

  return new;
end;
$$;

drop trigger if exists leads_operator_restrictions on leads;
create trigger leads_operator_restrictions
before update on leads
for each row execute function enforce_operator_column_restrictions();

-- ----- REFERRAL_PARTNERS POLICIES -----
-- Operators should NOT be able to manage partners — only owners
-- The existing "Admins can manage all referral partners" policy is too broad.
drop policy if exists "Admins can manage all referral partners" on referral_partners;

create policy "Owners can manage all referral partners"
on referral_partners for all to authenticated
using (is_owner(auth.uid()))
with check (is_owner(auth.uid()));

-- ----- ADMINS TABLE -----
drop policy if exists "Admins can read admin list" on admins;

create policy "All admins can read admin list"
on admins for select to authenticated
using (is_operator_or_owner(auth.uid()));

create policy "Only owners can manage admins"
on admins for insert to authenticated
with check (is_owner(auth.uid()));

create policy "Only owners can update admins"
on admins for update to authenticated
using (is_owner(auth.uid()));

create policy "Only owners can delete admins"
on admins for delete to authenticated
using (is_owner(auth.uid()));
