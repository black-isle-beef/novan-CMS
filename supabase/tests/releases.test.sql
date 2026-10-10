-- Releases (package 17, 0016): who reads and changes releases and their pages, and that a published one stays put.
--
-- Fixture: spaces A and B in separate organisations, a page in each with one version.
--   editor_a  editor of A    author_a  author of A    editor_b  editor of B
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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

select tests.create_user('00000000-0000-4000-8000-00000018a001', 'editor-a@releases.test');
select tests.create_user('00000000-0000-4000-8000-00000018a002', 'author-a@releases.test');
select tests.create_user('00000000-0000-4000-8000-00000018b001', 'editor-b@releases.test');

insert into public.organisations (id, name)
values ('00000000-0000-4000-8000-00000018a100', 'Org A'), ('00000000-0000-4000-8000-00000018b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000018a200', '00000000-0000-4000-8000-00000018a100', 'Space A', 'releases-a'),
  ('00000000-0000-4000-8000-00000018b200', '00000000-0000-4000-8000-00000018b100', 'Space B', 'releases-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000018a200'::uuid, '00000000-0000-4000-8000-00000018a001'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000018a200'::uuid, '00000000-0000-4000-8000-00000018a002'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000018b200'::uuid, '00000000-0000-4000-8000-00000018b001'::uuid, 'editor')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.content_types (space_id, environment_id, api_id, name, kind)
select space_id, id, 'page', 'Page', 'page' from public.environments
where space_id in ('00000000-0000-4000-8000-00000018a200', '00000000-0000-4000-8000-00000018b200') and is_main;

insert into public.entries (id, space_id, environment_id, content_type_id, slug)
select
  case when e.space_id = '00000000-0000-4000-8000-00000018a200'
    then '00000000-0000-4000-8000-00000018a300'::uuid else '00000000-0000-4000-8000-00000018b300'::uuid end,
  e.space_id, e.id, ct.id, 'launch'
from public.environments e
join public.content_types ct on ct.environment_id = e.id
where e.space_id in ('00000000-0000-4000-8000-00000018a200', '00000000-0000-4000-8000-00000018b200') and e.is_main;

insert into public.entry_versions (id, entry_id, space_id, data)
values
  ('00000000-0000-4000-8000-00000018a400', '00000000-0000-4000-8000-00000018a300', '00000000-0000-4000-8000-00000018a200', '{"title": "A"}'),
  ('00000000-0000-4000-8000-00000018b400', '00000000-0000-4000-8000-00000018b300', '00000000-0000-4000-8000-00000018b200', '{"title": "B"}');

-- A has a draft release and a published one, each with its page.
insert into public.releases (id, space_id, environment_id, name, status, published_at)
select v.id, e.space_id, e.id, v.name, v.status, v.published_at
from (
  values
    ('00000000-0000-4000-8000-00000018a500'::uuid, 'Draft', 'draft', null::timestamptz),
    ('00000000-0000-4000-8000-00000018a501'::uuid, 'Launched', 'published', now())
) as v (id, name, status, published_at)
join public.environments e on e.space_id = '00000000-0000-4000-8000-00000018a200' and e.is_main;

insert into public.release_items (release_id, space_id, environment_id, entry_id, version_id)
select r.id, r.space_id, r.environment_id, '00000000-0000-4000-8000-00000018a300', '00000000-0000-4000-8000-00000018a400'
from public.releases r where r.space_id = '00000000-0000-4000-8000-00000018a200';

-- ---------------------------------------------------------------------------
-- An editor of A
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000018a001');

select is((select count(*)::int from public.releases), 2, 'an editor sees the space''s releases');
select lives_ok(
  $$insert into public.releases (space_id, environment_id, name, created_by)
    select space_id, id, 'Mine', '00000000-0000-4000-8000-00000018a001' from public.environments
    where space_id = '00000000-0000-4000-8000-00000018a200' and is_main$$,
  'and creates one, as themselves'
);
select throws_ok(
  $$insert into public.releases (space_id, environment_id, name, created_by, status, published_at)
    select space_id, id, 'Sneaky', '00000000-0000-4000-8000-00000018a001', 'published', now() from public.environments
    where space_id = '00000000-0000-4000-8000-00000018a200' and is_main$$,
  '42501', null, 'a release starts as a draft'
);
select lives_ok(
  $$update public.releases set name = 'Renamed' where id = '00000000-0000-4000-8000-00000018a500'$$,
  'a draft can be renamed'
);
select throws_ok(
  $$update public.releases set status = 'failed', error = 'made up' where id = '00000000-0000-4000-8000-00000018a500'$$,
  '23514', null, 'but not marked failed'
);
select throws_ok(
  $$update public.releases set name = 'Renamed' where id = '00000000-0000-4000-8000-00000018a501'$$,
  '23514', null, 'a published release cannot change'
);
select throws_ok(
  $$delete from public.release_items where release_id = '00000000-0000-4000-8000-00000018a501'$$,
  '23514', null, 'nor its pages'
);
select is_empty(
  $$delete from public.releases where id = '00000000-0000-4000-8000-00000018a501' returning id$$,
  'nor can it be deleted'
);
select throws_ok(
  $$update public.release_items set version_id = '00000000-0000-4000-8000-00000018b400'
    where release_id = '00000000-0000-4000-8000-00000018a500'$$,
  '23503', null, 'a release names a version of its own page'
);

-- ---------------------------------------------------------------------------
-- An author of A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000018a002');
select is((select count(*)::int from public.release_items), 2, 'an author sees releases and their pages');
select throws_ok(
  $$insert into public.releases (space_id, environment_id, name, created_by)
    select space_id, id, 'Author''s', '00000000-0000-4000-8000-00000018a002' from public.environments
    where space_id = '00000000-0000-4000-8000-00000018a200' and is_main$$,
  '42501', null, 'but cannot create one'
);
select is_empty(
  $$delete from public.release_items where release_id = '00000000-0000-4000-8000-00000018a500' returning entry_id$$,
  'nor take pages out'
);

-- ---------------------------------------------------------------------------
-- Another space
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000018b001');
select is((select count(*)::int from public.releases where space_id = '00000000-0000-4000-8000-00000018a200'), 0, 'an editor of B cannot see A''s releases');
select is((select count(*)::int from public.release_items where space_id = '00000000-0000-4000-8000-00000018a200'), 0, 'nor their pages');
select throws_ok(
  $$insert into public.release_items (release_id, space_id, environment_id, entry_id, version_id)
    select '00000000-0000-4000-8000-00000018a500', '00000000-0000-4000-8000-00000018a200', environment_id, id, '00000000-0000-4000-8000-00000018a400'
    from public.entries where id = '00000000-0000-4000-8000-00000018b300'$$,
  '42501', null, 'nor add pages to them'
);
select is_empty(
  $$update public.releases set name = 'Taken' where space_id = '00000000-0000-4000-8000-00000018a200' returning id$$,
  'nor rename them'
);

select * from finish();
rollback;
