-- Migration 011: add 'calendly' as a valid prospect_interactions.source.
--
-- The Calendly webhook now auto-creates an interaction row on every booking
-- so the prospect shows up in /admin?view=interactions alongside the
-- deck_requests update. Use the dedicated 'calendly' source value so the
-- interaction can be distinguished from manual entries / email BCC / etc.

alter table prospect_interactions
  drop constraint prospect_interactions_source_check;

alter table prospect_interactions
  add constraint prospect_interactions_source_check
  check (source in (
    'manual','email_bcc','ghl_sms','fathom','ios_shortcut','calendly','other'
  ));
