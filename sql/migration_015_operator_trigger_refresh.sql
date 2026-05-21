-- Migration 015: refresh enforce_operator_column_restrictions to match the
-- current leads schema after migrations 012 (dropped qualification,
-- internal_notes, referral_source) and 014 (dropped notes).
--
-- Symptom that prompted this: when an operator (e.g. Alondra) tried to save
-- a Company name or update a status, the UPDATE hit this trigger which
-- referenced new.notes / new.qualification / new.internal_notes /
-- new.referral_source — all dropped columns. Postgres raised
-- "record 'new' has no field 'notes'" and the save failed.
--
-- This redefines the trigger to reference only columns that exist today,
-- and adds `company` to the operator-editable list since they need to fill
-- the LLC for underwriting.

create or replace function enforce_operator_column_restrictions()
returns trigger language plpgsql as $$
declare
  caller_role admin_role;
begin
  select role into caller_role from admins where user_id = auth.uid();

  -- Owners can do anything; if not an admin at all, RLS already blocked us.
  if caller_role = 'owner' or caller_role is null then
    return new;
  end if;

  -- Operators CAN change:
  --   status, status_updated_by, status_updated_at,
  --   estimated_equipment_value, estimated_total_commission,
  --   company  (newly allowed — needed for underwriting)
  --
  -- Everything else reverts to the old value.
  new.first_name           := old.first_name;
  new.last_name            := old.last_name;
  new.email                := old.email;
  new.phone                := old.phone;
  new.state                := old.state;
  new.equipment_range      := old.equipment_range;
  new.net_worth            := old.net_worth;
  new.liquidity            := old.liquidity;
  new.referral_partner_id  := old.referral_partner_id;
  new.import_source        := old.import_source;
  new.created_at           := old.created_at;

  return new;
end;
$$;
