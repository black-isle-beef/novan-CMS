-- SEO and site features (package 14): redirects, automatic 301s when a published page's address changes, and
-- not_found_hits.
--
-- Fixture: space A and space B in separate organisations. A has a `blog` folder and a page published at
-- `/blog/hello`; B has nothing but a redirect and a recorded miss.
--   editor_a  editor of A    author_a  author of A    admin_b  admin of B
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create schema tests;

create function tests.authenticate_as(user_id uuid, aal text default 'aal1')
returns void
language plpgsql
as $$
declare
  claims jsonb;
begin
  claims := public.custom_access_token_hook(jsonb_build_object(
    'user_id', user_id,
    'claims', jsonb_build_object('sub', user_id, 'role', 'authenticated', 'aal', aal)
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

-- The redirect from `from_path` in space A, as `to_path`, or null.
create function tests.redirect_a(from_path text)
returns text
language sql
security definer
as $$
  select to_path from public.redirects
  where space_id = '00000000-0000-4000-8000-00000014a200' and redirects.from_path = $1;
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000014a001', 'editor-a@seo.test');
select tests.create_user('00000000-0000-4000-8000-00000014a002', 'author-a@seo.test');
select tests.create_user('00000000-0000-4000-8000-00000014b001', 'admin-b@seo.test');

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000014a100', 'Org A'),
  ('00000000-0000-4000-8000-00000014b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000014a200', '00000000-0000-4000-8000-00000014a100', 'Space A', 'seo-a'),
  ('00000000-0000-4000-8000-00000014b200', '00000000-0000-4000-8000-00000014b100', 'Space B', 'seo-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000014a200'::uuid, '00000000-0000-4000-8000-00000014a001'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000014a200'::uuid, '00000000-0000-4000-8000-00000014a002'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000014b200'::uuid, '00000000-0000-4000-8000-00000014b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.content_types (space_id, environment_id, api_id, name, kind)
select space_id, id, 'page', 'Page', 'page' from public.environments
where space_id = '00000000-0000-4000-8000-00000014a200' and is_main;

insert into public.folders (id, space_id, environment_id, name, slug)
select '00000000-0000-4000-8000-00000014a500', space_id, id, 'Blog', 'blog' from public.environments
where space_id = '00000000-0000-4000-8000-00000014a200' and is_main;

insert into public.entries (id, space_id, environment_id, content_type_id, folder_id, slug, locale)
select '00000000-0000-4000-8000-00000014a300', e.space_id, e.id, ct.id, '00000000-0000-4000-8000-00000014a500', 'hello', 'en-GB'
from public.environments e
join public.content_types ct on ct.environment_id = e.id
where e.space_id = '00000000-0000-4000-8000-00000014a200' and e.is_main;

insert into public.entry_versions (id, entry_id, space_id, data)
values ('00000000-0000-4000-8000-00000014a400', '00000000-0000-4000-8000-00000014a300', '00000000-0000-4000-8000-00000014a200',
        '{"title": "Hello"}');
update public.entries
set current_version_id = '00000000-0000-4000-8000-00000014a400', published_version_id = '00000000-0000-4000-8000-00000014a400',
    status = 'published', published_at = now()
where id = '00000000-0000-4000-8000-00000014a300';

insert into public.published_content (entry_id, space_id, environment_id, content_type_api_id, full_path, locale, data, published_at)
select '00000000-0000-4000-8000-00000014a300', space_id, id, 'page', '/blog/hello', 'en-GB', '{"title": "Hello"}', now()
from public.environments where space_id = '00000000-0000-4000-8000-00000014a200' and is_main;

insert into public.redirects (space_id, from_path, to_path)
values ('00000000-0000-4000-8000-00000014b200', '/b-old', '/b-new');

select public.record_not_found('00000000-0000-4000-8000-00000014a200', '/missing', 'https://example.com/');
select public.record_not_found('00000000-0000-4000-8000-00000014a200', '/missing', null);
select public.record_not_found('00000000-0000-4000-8000-00000014b200', '/b-missing');

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------
-- Recording misses
-- ---------------------------------------------------------------------------
select is(
  (select hits from public.not_found_hits where space_id = '00000000-0000-4000-8000-00000014a200' and path = '/missing'),
  2,
  'misses at one address on one day are one row, counting the visits'
);
select is(
  (select last_referrer from public.not_found_hits where space_id = '00000000-0000-4000-8000-00000014a200' and path = '/missing'),
  'https://example.com/',
  'a visit without a referrer keeps the last one known'
);

-- ---------------------------------------------------------------------------
-- An editor of A
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000014a001');

select lives_ok(
  $$insert into public.redirects (space_id, from_path, to_path, created_by)
    values ('00000000-0000-4000-8000-00000014a200', '/old-contact', '/contact', '00000000-0000-4000-8000-00000014a001')$$,
  'an editor adds a redirect'
);
select throws_ok(
  $$insert into public.redirects (space_id, from_path, to_path, created_by)
    values ('00000000-0000-4000-8000-00000014a200', '/elsewhere', '/contact', '00000000-0000-4000-8000-00000014a002')$$,
  '42501', null, 'as themselves'
);
select throws_ok(
  $$insert into public.redirects (space_id, from_path, to_path, created_by)
    values ('00000000-0000-4000-8000-00000014a200', '/trailing/', '/contact', '00000000-0000-4000-8000-00000014a001')$$,
  '23514', null, 'from an address without a trailing slash'
);
select throws_ok(
  $$insert into public.redirects (space_id, from_path, to_path, created_by)
    values ('00000000-0000-4000-8000-00000014a200', '/loop', '/loop', '00000000-0000-4000-8000-00000014a001')$$,
  '23514', null, 'and not to itself'
);
select lives_ok(
  $$update public.redirects set to_path = 'https://example.com/contact', status = 302 where from_path = '/old-contact'$$,
  'an editor changes a redirect, to another site too'
);
select throws_ok(
  $$update public.redirects set space_id = '00000000-0000-4000-8000-00000014b200' where from_path = '/old-contact'$$,
  '23514', null, 'but cannot move it to another space'
);
select throws_ok(
  $$insert into public.redirects (space_id, from_path, to_path, created_by)
    values ('00000000-0000-4000-8000-00000014b200', '/sneaky', '/', '00000000-0000-4000-8000-00000014a001')$$,
  '42501', null, 'an editor of A cannot add a redirect to B'
);
select is(
  (select count(*)::int from public.redirects where space_id = '00000000-0000-4000-8000-00000014b200'),
  0,
  'nor see B''s redirects'
);
-- Checked as B below: these change nothing.
update public.redirects set to_path = '/hijacked' where space_id = '00000000-0000-4000-8000-00000014b200';
delete from public.redirects where space_id = '00000000-0000-4000-8000-00000014b200';
select is(
  (select count(*)::int from public.not_found_hits),
  1,
  'an editor of A sees A''s misses only'
);
select throws_ok(
  $$insert into public.not_found_hits (space_id, path, day) values ('00000000-0000-4000-8000-00000014a200', '/made-up', current_date)$$,
  '42501', null, 'misses are recorded by the API, not by members'
);
select throws_ok(
  $$select public.record_not_found('00000000-0000-4000-8000-00000014a200', '/made-up')$$,
  '42501', null, 'members cannot call the recording function'
);

-- ---------------------------------------------------------------------------
-- Automatic redirects, as an editor publishing and moving the page
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.published_content set full_path = '/blog/hello-world' where entry_id = '00000000-0000-4000-8000-00000014a300'$$,
  'a new slug is published'
);
select is(tests.redirect_a('/blog/hello'), '/blog/hello-world', 'the old address redirects to the new one');
select is(
  (select status::int from public.redirects where from_path = '/blog/hello'),
  301,
  'permanently, with no author'
);

update public.published_content set full_path = '/hello-world' where entry_id = '00000000-0000-4000-8000-00000014a300';
select is(tests.redirect_a('/blog/hello'), '/hello-world', 'moving again updates earlier redirects, so there is no chain');
select is(tests.redirect_a('/blog/hello-world'), '/hello-world', 'and redirects the address before');

update public.published_content set full_path = '/blog/hello' where entry_id = '00000000-0000-4000-8000-00000014a300';
select is(tests.redirect_a('/blog/hello'), null, 'moving back drops the redirect that would hide the page');
select is(tests.redirect_a('/hello-world'), '/blog/hello', 'and redirects where it just was');

-- ---------------------------------------------------------------------------
-- An author of A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000014a002');
select ok(
  (select count(*)::int from public.redirects) >= 3,
  'an author sees the space''s redirects'
);
select throws_ok(
  $$insert into public.redirects (space_id, from_path, to_path, created_by)
    values ('00000000-0000-4000-8000-00000014a200', '/author', '/', '00000000-0000-4000-8000-00000014a002')$$,
  '42501', null, 'but cannot add one'
);

-- ---------------------------------------------------------------------------
-- Renaming a folder moves the published pages in it, as the database does it (0006)
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000014a001');
select lives_ok(
  $$update public.folders set slug = 'news' where id = '00000000-0000-4000-8000-00000014a500'$$,
  'an editor renames the folder'
);
select is(tests.redirect_a('/blog/hello'), '/news/hello', 'pages in it redirect from their old addresses');

-- ---------------------------------------------------------------------------
-- Another space
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000014b001');
select is(
  (select count(*)::int from public.redirects where space_id = '00000000-0000-4000-8000-00000014a200'),
  0,
  'an admin of B cannot see A''s redirects'
);
select is(
  (select array_agg(path) from public.not_found_hits),
  array['/b-missing'],
  'nor A''s misses'
);
select is(
  (select array_agg(from_path || ' ' || to_path) from public.redirects),
  array['/b-old /b-new'],
  'B''s redirect is untouched by A''s editor'
);

select * from finish();
rollback;
