-- 0025 Published pages with custom HTML blocks (`customHtml` in @novan/blocks, libs/api/delivery/src/lib/site-css.ts).
--
-- The site's stylesheet of custom HTML blocks' CSS is built from the published pages that contain one. Without this,
-- finding them means walking every published page's data. `has_custom_html` is worked out by Postgres from `data`
-- whenever a row is written, as `search` is (0019), so publishing needs no change and the flag cannot drift. It is true
-- when any block at any depth is a `customHtml` block, hidden ones included; the API leaves those out as it reads.
-- The partial index holds only the rows that have one, so it stays small however many pages a site has.
--
-- No policy or grant changes: the column is part of the row RLS already guards (0006), and generated columns cannot be
-- written. Adding a stored column rewrites the table once.

alter table public.published_content
  add column has_custom_html boolean not null
    generated always as (jsonb_path_exists(data, '$.** ? (@._block == "customHtml")')) stored;

create index published_content_custom_html_idx on public.published_content (space_id, environment_id)
  where has_custom_html;
