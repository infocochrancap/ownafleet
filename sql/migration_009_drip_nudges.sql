-- Migration 009: drip nudge tracking
--
-- Three automated nudges run daily from /api/cron-nudges:
--
--   1. nudge_no_book_sent_at   — Deck requested 3+ days ago, never booked
--   2. nudge_no_app_sent_at    — Booked 2+ days ago, no application yet
--   3. nudge_stalled_sent_at   — Mini-app submitted 5+ days ago, no full app
--
-- Each nudge stamps its own column on the relevant row, so the same prospect
-- never receives the same nudge twice. Partial indexes keep the cron's scan
-- queries cheap as the tables grow.

alter table deck_requests
  add column if not exists nudge_no_book_sent_at timestamptz,
  add column if not exists nudge_no_app_sent_at  timestamptz;

alter table leads
  add column if not exists nudge_stalled_sent_at timestamptz;

create index if not exists deck_requests_nudge_no_book_idx
  on deck_requests(created_at)
  where booked_at is null and nudge_no_book_sent_at is null;

create index if not exists deck_requests_nudge_no_app_idx
  on deck_requests(booked_at)
  where booked_at is not null and nudge_no_app_sent_at is null;

create index if not exists leads_nudge_stalled_idx
  on leads(status_updated_at)
  where status = 'mini_app_submitted' and nudge_stalled_sent_at is null;
