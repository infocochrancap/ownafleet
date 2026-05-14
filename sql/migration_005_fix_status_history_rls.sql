-- ============================================================
-- Migration 005 — Status-change trigger bypasses RLS
--
-- The record_lead_status_change() trigger fires when a lead's status
-- is updated and writes a row to lead_status_history. That table has
-- only SELECT policies (no INSERT policy), so the trigger fails RLS
-- when called by an admin updating a lead. Adding SECURITY DEFINER
-- so the trigger runs with elevated privileges, which is the standard
-- pattern for audit-log triggers.
--
-- Symptom before this fix: "new row violates row-level security policy
-- for table lead_status_history" when changing any lead's status from
-- /admin or via the Send-Armada-application admin action.
-- ============================================================

create or replace function record_lead_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into lead_status_history (lead_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, new.status_updated_by);
    new.status_updated_at = now();
  end if;
  return new;
end;
$$;
