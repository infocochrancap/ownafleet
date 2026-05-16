-- Migration 008: tighten booking tracking on deck_requests
--
-- Before: the Calendly webhook only recorded a deck_requests row when the
-- booker had no prior deck request. If they came through the gate first
-- and then booked, the webhook saw an existing row and no-op'd. That made
-- the funnel's "Bookings" count miss the deck-first path — the intended
-- happy case.
--
-- After: every booking stamps booked_at on the deck_requests row (insert
-- or update). The funnel counts bookings as `booked_at is not null`.
--
-- Side benefits: time-to-book becomes computable, and the "requested-but-
-- never-booked" cohort is cleanly identifiable for drip nudges.

alter table deck_requests
  add column if not exists booked_at timestamptz;

create index if not exists deck_requests_booked_at_idx
  on deck_requests(booked_at)
  where booked_at is not null;
