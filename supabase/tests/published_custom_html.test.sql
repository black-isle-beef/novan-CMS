-- Published pages with custom HTML blocks (0025): `published_content.has_custom_html` follows the page's data, at any
-- depth and on every write, cannot be written, and the partial index the site stylesheet reads by holds only those rows.
--
-- Fixture: one space with a page type and four entries, published as the API publishes them (as the table owner).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.organisations (id, name) values ('00000000-0000-4000-8000-00000025a100', 'Org A');
insert into public.spaces (id, organisation_id, name, slug)
values ('00000000-0000-4000-8000-00000025a200', '00000000-0000-4000-8000-00000025a100', 'Space A', 'custom-html-a');

insert into public.content_types (space_id, environment_id, api_id, name, kind)
select space_id, id, 'page', 'Page', 'page' from public.environments
where space_id = '00000000-0000-4000-8000-00000025a200' and is_main;

insert into public.entries (id, space_id, environment_id, content_type_id, slug)
select n.id, e.space_id, e.id, t.id, n.slug
from public.environments e
join public.content_types t on t.environment_id = e.id
cross join (
  values
    ('00000000-0000-4000-8000-00000025a301'::uuid, 'top-level'),
    ('00000000-0000-4000-8000-00000025a302'::uuid, 'nested'),
    ('00000000-0000-4000-8000-00000025a303'::uuid, 'plain'),
    ('00000000-0000-4000-8000-00000025a304'::uuid, 'look-alike')
) as n (id, slug)
where e.space_id = '00000000-0000-4000-8000-00000025a200' and e.is_main;

insert into public.published_content (entry_id, space_id, environment_id, content_type_api_id, full_path, data, published_at)
select e.id, e.space_id, e.environment_id, 'page', '/' || e.slug, d.data, now()
from public.entries e
join (
  values
    ('00000000-0000-4000-8000-00000025a301'::uuid,
     $json${"body": [{"_uid": "u1", "_block": "customHtml", "html": "<p>Hi</p>", "css": "p { color: red }"}]}$json$::jsonb),
    ('00000000-0000-4000-8000-00000025a302'::uuid,
     $json${"body": [{"_uid": "u1", "_block": "columns", "children": [{"_uid": "u2", "_block": "customHtml", "html": "<p>Hi</p>"}]}]}$json$::jsonb),
    ('00000000-0000-4000-8000-00000025a303'::uuid,
     $json${"body": [{"_uid": "u1", "_block": "richText"}]}$json$::jsonb),
    -- Text that mentions the block, and a field that happens to be called `_block`, are not blocks of that type.
    ('00000000-0000-4000-8000-00000025a304'::uuid,
     $json${"title": "customHtml", "body": [{"_uid": "u1", "_block": "cta", "text": "_block customHtml"}]}$json$::jsonb)
) as d (id, data) on d.id = e.id;

create function pg_temp.flag(entry uuid)
returns boolean
language sql
as $$
  select has_custom_html from public.published_content where entry_id = entry;
$$;

-- The plan of a query, one line per row.
create function pg_temp.explain(query text)
returns setof text
language plpgsql
as $$
declare
  line text;
begin
  for line in execute 'explain ' || query loop
    return next line;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The column and the index
-- ---------------------------------------------------------------------------
select col_type_is('public', 'published_content', 'has_custom_html', 'boolean', 'has_custom_html is a boolean');
select col_not_null('public', 'published_content', 'has_custom_html', '... never null');
select is(
  (select attgenerated::text from pg_attribute
   where attrelid = 'public.published_content'::regclass and attname = 'has_custom_html'),
  's', '... and generated from the data, stored'
);
select is(
  (select pg_get_expr(indpred, indrelid) from pg_index where indexrelid = 'public.published_content_custom_html_idx'::regclass),
  'has_custom_html', 'the index holds only pages with a custom HTML block'
);

-- ---------------------------------------------------------------------------
-- What counts
-- ---------------------------------------------------------------------------
select ok(pg_temp.flag('00000000-0000-4000-8000-00000025a301'), 'a custom HTML block in a blocks field is found');
select ok(pg_temp.flag('00000000-0000-4000-8000-00000025a302'), '... and one inside another block');
select ok(not pg_temp.flag('00000000-0000-4000-8000-00000025a303'), 'a page without one is not flagged');
select ok(not pg_temp.flag('00000000-0000-4000-8000-00000025a304'), '... nor one that only mentions it in text');

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------
update public.published_content set data = '{"body": []}' where entry_id = '00000000-0000-4000-8000-00000025a301';
update public.published_content
set data = $json${"body": [{"_uid": "u9", "_block": "customHtml", "html": "<p>New</p>"}]}$json$
where entry_id = '00000000-0000-4000-8000-00000025a303';
select results_eq(
  $$select entry_id from public.published_content
    where space_id = '00000000-0000-4000-8000-00000025a200' and has_custom_html order by entry_id$$,
  $$values ('00000000-0000-4000-8000-00000025a302'::uuid), ('00000000-0000-4000-8000-00000025a303'::uuid)$$,
  'republishing updates the flag both ways'
);

select throws_ok(
  $$update public.published_content set has_custom_html = true where entry_id = '00000000-0000-4000-8000-00000025a304'$$,
  '428C9', null, 'the flag cannot be written'
);

-- The stylesheet's query can use the partial index.
set local enable_seqscan = off;
select ok(
  (select string_agg(line, ' ') from pg_temp.explain(format(
     'select data from public.published_content where space_id = %L and environment_id = %L and has_custom_html',
     '00000000-0000-4000-8000-00000025a200',
     (select id from public.environments where space_id = '00000000-0000-4000-8000-00000025a200' and is_main)
   )) as plan (line)) like '%published_content_custom_html_idx%',
  'the stylesheet query uses the index'
);

select * from finish();
rollback;
