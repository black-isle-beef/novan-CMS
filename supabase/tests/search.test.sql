-- Search (package 18, 0019): what text is searched, that drafts are indexed as they are saved, and that one space
-- never finds another's content.
--
-- Fixture: spaces A and B in separate organisations, each with a page whose current version is a draft and a published
-- copy, and a file.
--   author_a  author of A    author_b  author of B
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create schema tests;

create function tests.authenticate_as(user_id uuid)
returns void
language plpgsql
as $$
declare
  claims jsonb;
begin
  claims := public.custom_access_token_hook(jsonb_build_object(
    'user_id', user_id,
    'claims', jsonb_build_object('sub', user_id, 'role', 'authenticated', 'aal', 'aal1')
  )) -> 'claims';
  perform set_config('request.jwt.claims', claims::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function tests.create_user(id uuid, email text)
returns void
language sql
as $$
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, '{}', now(), now());
$$;

select tests.create_user('00000000-0000-4000-8000-00000020a001', 'author-a@search.test');
select tests.create_user('00000000-0000-4000-8000-00000020b001', 'author-b@search.test');

insert into public.organisations (id, name)
values ('00000000-0000-4000-8000-00000020a100', 'Org A'), ('00000000-0000-4000-8000-00000020b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000020a200', '00000000-0000-4000-8000-00000020a100', 'Space A', 'search-a'),
  ('00000000-0000-4000-8000-00000020b200', '00000000-0000-4000-8000-00000020b100', 'Space B', 'search-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000020a200'::uuid, '00000000-0000-4000-8000-00000020a001'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000020b200'::uuid, '00000000-0000-4000-8000-00000020b001'::uuid, 'author')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.content_types (space_id, environment_id, api_id, name, kind)
select space_id, id, 'page', 'Page', 'page' from public.environments
where space_id in ('00000000-0000-4000-8000-00000020a200', '00000000-0000-4000-8000-00000020b200') and is_main;

-- An entry and its first version in each space: A's page is about gardens, B's about bicycles.
insert into public.entries (id, space_id, environment_id, content_type_id, slug)
select
  case when e.space_id = '00000000-0000-4000-8000-00000020a200'
    then '00000000-0000-4000-8000-00000020a300'::uuid else '00000000-0000-4000-8000-00000020b300'::uuid end,
  e.space_id, e.id, t.id, 'first-page'
from public.environments e
join public.content_types t on t.environment_id = e.id
where e.space_id in ('00000000-0000-4000-8000-00000020a200', '00000000-0000-4000-8000-00000020b200') and e.is_main;

insert into public.entry_versions (id, entry_id, space_id, data, autosave, created_by)
values
  ('00000000-0000-4000-8000-00000020a400', '00000000-0000-4000-8000-00000020a300', '00000000-0000-4000-8000-00000020a200',
   $json${"title": {"en-GB": "Garden tours", "fr-FR": "Visites des jardins"}, "body": [
     {"_uid": "u1", "_block": "richText", "body": {"type": "doc", "content": [
       {"type": "paragraph", "content": [{"type": "text", "text": "Roses bloom in June."}]}]}}
   ]}$json$, true, '00000000-0000-4000-8000-00000020a001'),
  ('00000000-0000-4000-8000-00000020b400', '00000000-0000-4000-8000-00000020b300', '00000000-0000-4000-8000-00000020b200',
   '{"title": "Bicycle repairs"}', false, '00000000-0000-4000-8000-00000020b001');

update public.entries set current_version_id = '00000000-0000-4000-8000-00000020a400' where id = '00000000-0000-4000-8000-00000020a300';
update public.entries set current_version_id = '00000000-0000-4000-8000-00000020b400' where id = '00000000-0000-4000-8000-00000020b300';

insert into public.published_content (entry_id, space_id, environment_id, content_type_api_id, full_path, data, published_at)
select e.id, e.space_id, e.environment_id, 'page', '/first-page', v.data, now()
from public.entries e join public.entry_versions v on v.id = e.current_version_id
where e.id in ('00000000-0000-4000-8000-00000020a300', '00000000-0000-4000-8000-00000020b300');

insert into public.assets (id, space_id, path, filename, mime, size_bytes, alt, title, tags)
values (
  '00000000-0000-4000-8000-00000020a500', '00000000-0000-4000-8000-00000020a200',
  'spaces/00000000-0000-4000-8000-00000020a200/00000000-0000-4000-8000-00000020a500/rose-bed.jpg',
  'rose-bed.jpg', 'image/jpeg', 100, 'Red roses by a wall', null, '{summer}'
);

-- ---------------------------------------------------------------------------
-- What is searched
-- ---------------------------------------------------------------------------
select is(
  public.search_text($json${"_uid": "x", "_block": "cta", "action": {"type": "internal", "entryId": "e1", "text": "Read more"},
    "image": {"assetId": "a1", "alt": "A dog"}}$json$),
  'A dog Read more',
  'text visitors read is searched; block names, ids and node types are not'
);
select is(
  public.search_text('{"title": {"en-GB": "Hello", "fr-FR": "Bonjour"}}', array['fr-FR', 'en-GB']),
  'Bonjour',
  'a translated value gives the first locale it has'
);
select is(
  public.search_text('{"title": {"en-GB": "Hello"}}', array['de-DE', 'en-GB']),
  'Hello',
  'and falls back along the locales'
);
select ok(
  public.search_document('{"title": "Gardens"}') @@ to_tsquery('pg_catalog.english', 'garden:A'),
  'the title counts most (weight A), stemmed'
);
select ok(
  (select search @@ to_tsquery('pg_catalog.english', 'rose & jardin') from public.published_content
   where entry_id = '00000000-0000-4000-8000-00000020a300'),
  'published content is searchable in every locale, rich text included'
);
select ok(
  (select search @@ to_tsquery('pg_catalog.english', 'summer & rose & bed') from public.assets
   where id = '00000000-0000-4000-8000-00000020a500'),
  'files are found by alt text, file name and tags'
);

-- ---------------------------------------------------------------------------
-- Drafts are indexed as they are saved
-- ---------------------------------------------------------------------------
select results_eq(
  $$select title from public.entry_search where entry_id = '00000000-0000-4000-8000-00000020a300'$$,
  $$values ('Garden tours')$$,
  'a saved draft has a search row, titled in the default locale'
);

select tests.authenticate_as('00000000-0000-4000-8000-00000020a001');

update public.entry_versions
set data = '{"title": {"en-GB": "Orchard walks"}}'
where id = '00000000-0000-4000-8000-00000020a400';

select results_eq(
  $$select title, search @@ to_tsquery('pg_catalog.english', 'orchard') from public.entry_search
    where entry_id = '00000000-0000-4000-8000-00000020a300'$$,
  $$values ('Orchard walks', true)$$,
  'an autosave updates it'
);
select ok(
  (select search @@ to_tsquery('pg_catalog.english', 'garden') from public.published_content
   where entry_id = '00000000-0000-4000-8000-00000020a300'),
  'while the published copy keeps what was published'
);

insert into public.entry_versions (id, entry_id, space_id, data, created_by)
values ('00000000-0000-4000-8000-00000020a401', '00000000-0000-4000-8000-00000020a300', '00000000-0000-4000-8000-00000020a200',
        '{"title": {"en-GB": "Meadow picnics"}}', '00000000-0000-4000-8000-00000020a001');
update public.entries
set current_version_id = '00000000-0000-4000-8000-00000020a401', slug = 'meadow'
where id = '00000000-0000-4000-8000-00000020a300';

select results_eq(
  $$select title, search @@ to_tsquery('pg_catalog.english', 'meadow:A & meadow:B') from public.entry_search
    where entry_id = '00000000-0000-4000-8000-00000020a300'$$,
  $$values ('Meadow picnics', true)$$,
  'and so does a new version, with the slug'
);

-- ---------------------------------------------------------------------------
-- Spaces
-- ---------------------------------------------------------------------------
select results_eq(
  'select entry_id from public.entry_search',
  $$values ('00000000-0000-4000-8000-00000020a300'::uuid)$$,
  'a member of A finds only A''s drafts'
);
select results_eq(
  $$select entry_id from public.published_content where search @@ to_tsquery('pg_catalog.english', 'bicycl | garden')$$,
  $$values ('00000000-0000-4000-8000-00000020a300'::uuid)$$,
  'and only A''s published content'
);
select results_eq(
  $$select id from public.assets where search @@ to_tsquery('pg_catalog.english', 'rose')$$,
  $$values ('00000000-0000-4000-8000-00000020a500'::uuid)$$,
  'and A''s files'
);
select throws_ok(
  $$insert into public.entry_search (entry_id, space_id, environment_id, title, search)
    select entry_id, space_id, environment_id, 'Spam', to_tsvector('spam') from public.entry_search$$,
  '42501', null, 'nobody writes search rows directly'
);
select throws_ok(
  $$update public.entry_search set title = 'Changed'$$,
  '42501', null, 'or changes them'
);
select throws_ok(
  $$select public.refresh_entry_search('00000000-0000-4000-8000-00000020b300')$$,
  '42501', null, 'or refreshes them'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000020b001');
select results_eq(
  'select title from public.entry_search',
  $$values ('Bicycle repairs')$$,
  'a member of B finds only B''s drafts'
);
select is_empty(
  $$select id from public.assets where search @@ to_tsquery('pg_catalog.english', 'rose')$$,
  'and none of A''s files'
);

select * from finish();
rollback;
