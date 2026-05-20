-- Migration 012: simplify leads schema for spreadsheet migration
--
-- - Add 'not_now' and 'archived' to lead_status enum
-- - Add columns: company, import_source
-- - Merge internal_notes content into notes, then drop internal_notes
-- - Drop qualification (and its auto-classifier trigger) — manual judgment > robot
-- - Drop referral_source — redundant with referral_partner_id + interactions log
-- - Make form-only fields (equipment_range, net_worth, liquidity, email,
--   phone, state) nullable so spreadsheet imports can land without dummies

-- 1) New status enum values
alter type lead_status add value if not exists 'not_now';
alter type lead_status add value if not exists 'archived';

-- 2) New columns
alter table leads
  add column if not exists company text,
  add column if not exists import_source text;

-- 3) Merge internal_notes into notes BEFORE dropping the column
update leads
set notes = case
  when coalesce(notes, '') = '' then internal_notes
  when internal_notes is null then notes
  else notes || E'\n\n--- Internal notes ---\n' || internal_notes
end
where internal_notes is not null;

-- 4) Drop columns
alter table leads drop column if exists qualification;
alter table leads drop column if exists internal_notes;
alter table leads drop column if exists referral_source;

-- 5) Drop the auto-classifier trigger + function (qualification is gone)
drop trigger if exists leads_classify_trigger on leads;
drop function if exists classify_lead_qualification();

-- 6) Make form-only fields nullable for imports
alter table leads alter column equipment_range drop not null;
alter table leads alter column net_worth drop not null;
alter table leads alter column liquidity drop not null;
alter table leads alter column email drop not null;
alter table leads alter column phone drop not null;
alter table leads alter column state drop not null;

-- 7) Helpful index on company for search/filter
create index if not exists leads_company_idx
  on leads(lower(company))
  where company is not null;
