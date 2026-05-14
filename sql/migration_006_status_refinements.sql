-- ============================================================
-- Migration 006 — Lead status enum refinements
--
-- Aligns lead_status with the actual deal flow per Josh (2026-05-14):
--   New → Contacted → Application Sent
--     → Mini App Submitted     (was: Application Started)
--     → Full App Submitted     (was: Documents Uploaded)
--     → Approved
--     → Terms Accepted         (NEW — proforma + wire/legal out)
--     → Funded                 (wire in + legal signed)
--     → Operating              (NEW — distributions flowing, debt servicing)
--   Dead at any point.
--
-- Postgres doesn't allow removing enum values, so old values
-- ('application_started', 'documents_uploaded', 'closed_won') remain
-- in the type for backward compatibility but are hidden from the
-- admin UI. They can be reused or ignored — no existing leads need
-- migration as of this date.
-- ============================================================

alter type lead_status add value if not exists 'mini_app_submitted' after 'application_sent';
alter type lead_status add value if not exists 'full_app_submitted' after 'mini_app_submitted';
alter type lead_status add value if not exists 'terms_accepted' after 'approved';
alter type lead_status add value if not exists 'operating' after 'funded';
