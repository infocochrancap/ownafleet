-- Migration 014: Migrate `leads.notes` content into `lead_comments`,
-- then drop the `notes` column.
--
-- Rationale: notes + comments overlapped. Notes was a single editable text
-- field with no author/timestamp; comments are a proper chronological,
-- attributed feed. Going forward, comments is the only place team commentary
-- lives. Existing notes content is preserved by being inserted as one
-- comment per lead (backdated to the lead's created_at).

-- 1) Migrate existing notes content → one comment per lead.
--    Attribute to the owner (Josh) since the historical content was
--    almost all his entries or his imports.
insert into lead_comments (lead_id, author_id, comment, created_at)
select
  l.id,
  (select user_id from admins where role = 'owner' order by created_at asc limit 1),
  '[Imported from legacy notes field]' || E'\n\n' || l.notes,
  l.created_at
from leads l
where l.notes is not null
  and trim(l.notes) <> '';

-- 2) Drop the column.
alter table leads drop column if exists notes;
