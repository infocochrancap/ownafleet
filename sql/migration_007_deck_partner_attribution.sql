-- ============================================================
-- Migration 007 — Partner attribution on deck requests
--
-- When a partner shares ownafleet.com/deck?ref=THEIR_CODE and the
-- prospect requests the deck through the email gate, we want to
-- attribute that deck_request to the partner. This adds a nullable
-- referral_partner_id column to deck_requests.
--
-- Also adds a `source` column so we can distinguish:
--   'gate'           = prospect submitted /deck gate
--   'calendly_book'  = auto-sent after Calendly booking (new)
--   'lead_form'      = (future) prospect filled main lead form
-- ============================================================

alter table deck_requests
  add column if not exists referral_partner_id uuid references referral_partners(id) on delete set null,
  add column if not exists source text not null default 'gate';

create index if not exists deck_requests_partner_idx on deck_requests(referral_partner_id);
create index if not exists deck_requests_source_idx on deck_requests(source);
