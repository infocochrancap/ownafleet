-- ============================================================
-- Migration 004 — Update qualification trigger for new buckets
-- Run this in Supabase SQL Editor AFTER migration_003.
--
-- Form's liquidity dropdown moved: 'Under $300K' → 'Under $200K'
-- and '$300K – $1M' → '$200K – $1M'. Update the auto-classification
-- trigger so new leads get the right qualification tier shown in /admin.
-- Equipment range list also updated to match the current form (capped at
-- $5M with an 'Over $5M — consultation' option).
-- ============================================================

create or replace function classify_lead_qualification()
returns trigger language plpgsql as $$
declare
  meets_networth boolean;
  meets_liquidity boolean;
  meets_equipment boolean;
begin
  -- Current form equipment options. Old enum values (e.g. '$5M – $10M')
  -- are kept here too for backward compatibility with historical leads.
  meets_equipment := new.equipment_range in (
    '$500K – $1M','$1M – $2M','$2M – $5M',
    'Over $5M — consultation',
    -- legacy values from before the $5M cap:
    '$5M – $10M','$10M – $25M','$25M – $50M','$50M+'
  );
  meets_networth  := new.net_worth in ('$3M – $10M','$10M – $30M','$30M – $75M','$75M – $150M','$150M+');
  meets_liquidity := new.liquidity in (
    '$200K – $1M','$1M – $3M','$3M – $10M','$10M – $25M','$25M+',
    -- legacy value (pre-Oct 2026 bucket rename):
    '$300K – $1M'
  );

  if meets_equipment and meets_networth and meets_liquidity then
    new.qualification := 'hot';
  elsif (meets_equipment::int + meets_networth::int + meets_liquidity::int) >= 2 then
    new.qualification := 'warm';
  elsif new.equipment_range = 'Not sure yet'
     or new.net_worth = 'Under $1M'
     or new.liquidity in ('Under $200K', 'Under $300K')  -- both old and new bucket
  then
    new.qualification := 'needs_review';
  else
    new.qualification := 'unqualified';
  end if;

  return new;
end;
$$;
