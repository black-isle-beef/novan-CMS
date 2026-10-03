-- Entries (package 06): constraints, triggers and row-level security for folders, entries,
-- entry_versions and published_content.
--
-- Fixture: spaces A and B in separate organisations, each with a `page` type, a `/blog` folder and a
-- `home` entry with one version; B's entry is published.
--   author_a  author of A    editor_a  editor of A    viewer_a  viewer of A    admin_b  admin of B
--   staff     agency staff, member of nothing (privileged only at AAL2)
-- A member of A can neither read nor write B. In A, authors write drafts, only editors publish or bin,
-- and versions never change apart from the author's own recent autosave.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

-- ---------------------------------------------------------------------------
-- Helpers (as in tenancy.test.sql), rolled back with the test.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000006a001', 'author-a@entries.test');
select tests.create_user('00000000-0000-4000-8000-00000006a002', 'editor-a@entries.test');
select tests.create_user('00000000-0000-4000-8000-00000006a003', 'viewer-a@entries.test');
select tests.create_user('00000000-0000-4000-8000-00000006b001', 'admin-b@entries.test');
select tests.create_user('00000000-0000-4000-8000-00000006c001', 'staff@entries.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000006c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000006a100', 'Org A'),
  ('00000000-0000-4000-8000-00000006b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000006a200', '00000000-0000-4000-8000-00000006a100', 'Space A', 'entries-a'),
  ('00000000-0000-4000-8000-00000006b200', '00000000-0000-4000-8000-00000006b100', 'Space B', 'entries-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000006a200'::uuid, '00000000-0000-4000-8000-00000006a001'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000006a200'::uuid, '00000000-0000-4000-8000-00000006a002'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000006a200'::uuid, '00000000-0000-4000-8000-00000006a003'::uuid, 'viewer'),
    ('00000000-0000-4000-8000-00000006b200'::uuid, '00000000-0000-4000-8000-00000006b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

-- Each space's main environment and page type, readable by the roles under test.
insert into public.content_types (space_id, environment_id, api_id, name, kind)
select space_id, id, 'page', 'Page', 'page' from public.environments
where space_id in ('00000000-0000-4000-8000-00000006a200', '00000000-0000-4000-8000-00000006b200') and is_main;

create table tests.envs as
select e.space_id, e.id, ct.id as page_type_id
from public.environments e
join public.content_types ct on ct.environment_id = e.id
where e.space_id in ('00000000-0000-4000-8000-00000006a200', '00000000-0000-4000-8000-00000006b200') and e.is_main;
grant usage on schema tests to authenticated;
grant select on tests.envs to authenticated;

insert into public.folders (id, space_id, environment_id, name, slug)
select
  case when space_id = '00000000-0000-4000-8000-00000006a200'
    then '00000000-0000-4000-8000-00000006a500'::uuid else '00000000-0000-4000-8000-00000006b500'::uuid end,
  space_id, id, 'Blog', 'blog'
from tests.envs;

insert into public.entries (id, space_id, environment_id, content_type_id, slug, locale)
select
  case when space_id = '00000000-0000-4000-8000-00000006a200'
    then '00000000-0000-4000-8000-00000006a300'::uuid else '00000000-0000-4000-8000-00000006b300'::uuid end,
  space_id, id, page_type_id, 'home', 'en-GB'
from tests.envs;

insert into public.entry_versions (id, entry_id, space_id, data, created_by)
values
  ('00000000-0000-4000-8000-00000006a400', '00000000-0000-4000-8000-00000006a300',
   '00000000-0000-4000-8000-00000006a200', '{"title": "Home"}', '00000000-0000-4000-8000-00000006a001'),
  ('00000000-0000-4000-8000-00000006b400', '00000000-0000-4000-8000-00000006b300',
   '00000000-0000-4000-8000-00000006b200', '{"title": "Home"}', '00000000-0000-4000-8000-00000006b001');

update public.entries set current_version_id = '00000000-0000-4000-8000-00000006a400'
where id = '00000000-0000-4000-8000-00000006a300';
update public.entries
set current_version_id = '00000000-0000-4000-8000-00000006b400', published_version_id = '00000000-0000-4000-8000-00000006b400',
  status = 'published', published_at = now()
where id = '00000000-0000-4000-8000-00000006b300';

insert into public.published_content (entry_id, space_id, environment_id, content_type_api_id, full_path, locale, data, published_at)
select '00000000-0000-4000-8000-00000006b300', space_id, id, 'page', '/home', 'en-GB', '{"title": "Home"}', now()
from tests.envs where space_id = '00000000-0000-4000-8000-00000006b200';

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.entries (space_id, environment_id, content_type_id, slug, locale)
    select space_id, id, page_type_id, 'About Us', 'en-GB' from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  '23514', null, 'slugs are lowercase words joined by hyphens'
);
select throws_ok(
  $$insert into public.entries (space_id, environment_id, content_type_id, slug, locale)
    select space_id, id, page_type_id, 'home', 'en-GB' from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  '23505', null, 'two live entries cannot share an address in the root folder'
);
insert into public.entries (space_id, environment_id, content_type_id, slug, locale, deleted_at)
select space_id, id, page_type_id, 'old', 'en-GB', now() from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200';
select lives_ok(
  $$insert into public.entries (space_id, environment_id, content_type_id, slug, locale)
    select space_id, id, page_type_id, 'old', 'en-GB' from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  'an entry in the bin does not hold on to its address'
);
select throws_ok(
  $$insert into public.entries (space_id, environment_id, content_type_id, slug, locale)
    select '00000000-0000-4000-8000-00000006a200', a.id, b.page_type_id, 'stolen', 'en-GB'
    from tests.envs a, tests.envs b
    where a.space_id = '00000000-0000-4000-8000-00000006a200' and b.space_id = '00000000-0000-4000-8000-00000006b200'$$,
  '23503', null, 'an entry''s content type must be in its environment'
);
select throws_ok(
  $$insert into public.folders (space_id, environment_id, parent_id, name, slug)
    select space_id, id, '00000000-0000-4000-8000-00000006b500', 'News', 'news'
    from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  '23503', null, 'a folder''s parent must be in the same environment'
);
select throws_ok(
  $$update public.entries set status = 'published' where id = '00000000-0000-4000-8000-00000006a300'$$,
  '23514', null, 'a published entry needs a published version'
);
select throws_ok(
  $$insert into public.entry_versions (entry_id, space_id, data) values
    ('00000000-0000-4000-8000-00000006a300', '00000000-0000-4000-8000-00000006a200', '[]')$$,
  '23514', null, 'version data is a JSON object'
);
select throws_ok(
  $$update public.entries set current_version_id = '00000000-0000-4000-8000-00000006b400'
    where id = '00000000-0000-4000-8000-00000006a300'$$,
  '23503', null, 'an entry can only point at its own versions'
);
select throws_ok(
  $$update public.entries set content_type_id = gen_random_uuid() where id = '00000000-0000-4000-8000-00000006a300'$$,
  '23514', null, 'an entry''s type cannot change'
);

-- Folder paths follow parents and slugs, down the tree and into published addresses.
insert into public.folders (id, space_id, environment_id, parent_id, name, slug)
select '00000000-0000-4000-8000-00000006a501', space_id, id, '00000000-0000-4000-8000-00000006a500', 'News', 'news'
from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200';
select is(
  (select path from public.folders where id = '00000000-0000-4000-8000-00000006a501'),
  '/blog/news',
  'a subfolder''s path starts with its parent''s'
);

insert into public.entries (id, space_id, environment_id, content_type_id, folder_id, slug, locale)
select '00000000-0000-4000-8000-00000006a301', space_id, id, page_type_id, '00000000-0000-4000-8000-00000006a501', 'hello', 'en-GB'
from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200';
insert into public.entry_versions (id, entry_id, space_id, data)
values ('00000000-0000-4000-8000-00000006a401', '00000000-0000-4000-8000-00000006a301', '00000000-0000-4000-8000-00000006a200', '{}');
update public.entries
set current_version_id = '00000000-0000-4000-8000-00000006a401', published_version_id = '00000000-0000-4000-8000-00000006a401',
  status = 'published', published_at = now()
where id = '00000000-0000-4000-8000-00000006a301';
insert into public.published_content (entry_id, space_id, environment_id, content_type_api_id, full_path, locale, data, published_at)
select '00000000-0000-4000-8000-00000006a301', space_id, id, 'page', '/blog/news/hello', 'en-GB', '{}', now()
from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200';

update public.folders set slug = 'articles' where id = '00000000-0000-4000-8000-00000006a500';
select is(
  (select path from public.folders where id = '00000000-0000-4000-8000-00000006a501'),
  '/articles/news',
  'renaming a folder renames its subfolders'
);
select is(
  (select full_path from public.published_content where entry_id = '00000000-0000-4000-8000-00000006a301'),
  '/articles/news/hello',
  'renaming a folder moves the published pages inside it'
);
select throws_ok(
  $$update public.folders set parent_id = '00000000-0000-4000-8000-00000006a501' where id = '00000000-0000-4000-8000-00000006a500'$$,
  '23514', null, 'a folder cannot move inside itself'
);
select throws_ok(
  $$delete from public.folders where id = '00000000-0000-4000-8000-00000006a501'$$,
  '23503', null, 'a folder with pages in it cannot be deleted'
);

-- Versions never change, even for the table owner.
select throws_ok(
  $$update public.entry_versions set data = '{"title": "Changed"}' where id = '00000000-0000-4000-8000-00000006a400'$$,
  '42501', null, 'a saved version''s data cannot change'
);
select throws_ok(
  $$update public.entry_versions set created_at = now() - interval '1 day' where id = '00000000-0000-4000-8000-00000006a400'$$,
  '42501', null, 'a version''s time cannot change'
);
select throws_ok(
  $$delete from public.entry_versions where id = '00000000-0000-4000-8000-00000006a400'$$,
  '42501', null, 'a version cannot be deleted on its own'
);

-- ---------------------------------------------------------------------------
-- Author of A cannot read or write B
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000006a001');

select is_empty($$select 1 from public.folders where space_id = '00000000-0000-4000-8000-00000006b200'$$, 'A cannot read B''s folders');
select is_empty($$select 1 from public.entries where space_id = '00000000-0000-4000-8000-00000006b200'$$, 'A cannot read B''s entries');
select is_empty($$select 1 from public.entry_versions where space_id = '00000000-0000-4000-8000-00000006b200'$$, 'A cannot read B''s versions');
select is_empty($$select 1 from public.published_content where space_id = '00000000-0000-4000-8000-00000006b200'$$, 'A cannot read B''s published content');
select isnt_empty($$select 1 from public.entries where space_id = '00000000-0000-4000-8000-00000006a200'$$, 'A reads its own entries');

select throws_ok(
  $$insert into public.entries (space_id, environment_id, content_type_id, slug, locale)
    select space_id, id, page_type_id, 'rogue', 'en-GB' from tests.envs where space_id = '00000000-0000-4000-8000-00000006b200'$$,
  '42501', null, 'A cannot add entries to B'
);
select throws_ok(
  $$insert into public.entry_versions (entry_id, space_id, data, created_by) values
    ('00000000-0000-4000-8000-00000006b300', '00000000-0000-4000-8000-00000006b200', '{}', '00000000-0000-4000-8000-00000006a001')$$,
  '42501', null, 'A cannot add versions to B''s entries'
);
select throws_ok(
  $$insert into public.folders (space_id, environment_id, name, slug)
    select space_id, id, 'Rogue', 'rogue' from tests.envs where space_id = '00000000-0000-4000-8000-00000006b200'$$,
  '42501', null, 'A cannot add folders to B'
);
select throws_ok(
  $$insert into public.published_content (entry_id, space_id, environment_id, content_type_api_id, full_path, locale, data, published_at)
    select gen_random_uuid(), space_id, id, 'page', '/rogue', 'en-GB', '{}', now() from tests.envs where space_id = '00000000-0000-4000-8000-00000006b200'$$,
  '42501', null, 'A cannot publish into B'
);
select is_empty($$update public.entries set slug = 'taken' where space_id = '00000000-0000-4000-8000-00000006b200' returning 1$$, 'A cannot update B''s entries');
select is_empty($$update public.published_content set data = '{}' where space_id = '00000000-0000-4000-8000-00000006b200' returning 1$$, 'A cannot update B''s published content');
select throws_ok(
  $$update public.entries set space_id = '00000000-0000-4000-8000-00000006b200' where id = '00000000-0000-4000-8000-00000006a300'$$,
  '23514', null, 'A cannot move an entry into B'
);

-- ---------------------------------------------------------------------------
-- Author of A writes drafts, but cannot publish, bin or rename folders
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.entries (id, space_id, environment_id, content_type_id, slug, locale, created_by)
    select '00000000-0000-4000-8000-00000006a302', space_id, id, page_type_id, 'about', 'en-GB', '00000000-0000-4000-8000-00000006a001'
    from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  'author adds a draft entry'
);
select lives_ok(
  $$insert into public.entry_versions (id, entry_id, space_id, data, message, created_by) values
    ('00000000-0000-4000-8000-00000006a402', '00000000-0000-4000-8000-00000006a302', '00000000-0000-4000-8000-00000006a200',
     '{"title": "About"}', 'First draft', '00000000-0000-4000-8000-00000006a001')$$,
  'author saves a version as themselves'
);
select isnt_empty(
  $$update public.entries set current_version_id = '00000000-0000-4000-8000-00000006a402'
    where id = '00000000-0000-4000-8000-00000006a302' returning 1$$,
  'author points the entry at the new version'
);
select throws_ok(
  $$insert into public.entry_versions (entry_id, space_id, data, created_by) values
    ('00000000-0000-4000-8000-00000006a302', '00000000-0000-4000-8000-00000006a200', '{}', '00000000-0000-4000-8000-00000006a002')$$,
  '42501', null, 'author cannot save a version as someone else'
);
select throws_ok(
  $$update public.entries set status = 'published', published_version_id = current_version_id, published_at = now()
    where id = '00000000-0000-4000-8000-00000006a302'$$,
  '42501', null, 'author cannot publish'
);
select throws_ok(
  $$insert into public.entries (space_id, environment_id, content_type_id, slug, locale, deleted_at)
    select space_id, id, page_type_id, 'binned', 'en-GB', now() from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  '42501', null, 'author cannot create an entry straight into the bin'
);
select throws_ok(
  $$update public.entries set deleted_at = now() where id = '00000000-0000-4000-8000-00000006a302'$$,
  '42501', null, 'author cannot move an entry to the bin'
);
select throws_ok(
  $$delete from public.entries where id = '00000000-0000-4000-8000-00000006a302'$$,
  '42501', null, 'author cannot delete an entry for good'
);
select throws_ok(
  $$insert into public.published_content (entry_id, space_id, environment_id, content_type_api_id, full_path, locale, data, published_at)
    select '00000000-0000-4000-8000-00000006a302', space_id, id, 'page', '/about', 'en-GB', '{}', now()
    from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  '42501', null, 'author cannot write published content'
);
select lives_ok(
  $$insert into public.folders (space_id, environment_id, name, slug)
    select space_id, id, 'Drafts', 'drafts' from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  'author adds a folder'
);
select is_empty(
  $$update public.folders set slug = 'renamed' where id = '00000000-0000-4000-8000-00000006a500' returning 1$$,
  'author cannot rename a folder (it would move published pages)'
);

-- Autosave: the author's own current, unpublished autosave may be overwritten for two minutes.
select lives_ok(
  $$insert into public.entry_versions (id, entry_id, space_id, data, autosave, created_by) values
    ('00000000-0000-4000-8000-00000006a403', '00000000-0000-4000-8000-00000006a302', '00000000-0000-4000-8000-00000006a200',
     '{"title": "About u"}', true, '00000000-0000-4000-8000-00000006a001')$$,
  'author autosaves a version'
);
update public.entries set current_version_id = '00000000-0000-4000-8000-00000006a403' where id = '00000000-0000-4000-8000-00000006a302';
select isnt_empty(
  $$update public.entry_versions set data = '{"title": "About us"}' where id = '00000000-0000-4000-8000-00000006a403' returning 1$$,
  'autosave overwrites its own recent version'
);
select throws_ok(
  $$update public.entry_versions set message = 'Sneaky' where id = '00000000-0000-4000-8000-00000006a403'$$,
  '42501', null, 'autosave changes only the data'
);
select throws_ok(
  $$update public.entry_versions set data = '{}' where id = '00000000-0000-4000-8000-00000006a402'$$,
  '42501', null, 'an explicitly saved version stays as it was'
);
select throws_ok(
  $$update public.entry_versions set data = '{}' where id = '00000000-0000-4000-8000-00000006a400'$$,
  '42501', null, 'a version that is not the current one stays as it was'
);
insert into public.entry_versions (id, entry_id, space_id, data, autosave, created_by, created_at) values
  ('00000000-0000-4000-8000-00000006a404', '00000000-0000-4000-8000-00000006a302', '00000000-0000-4000-8000-00000006a200',
   '{"title": "About"}', true, '00000000-0000-4000-8000-00000006a001', now() - interval '3 minutes');
update public.entries set current_version_id = '00000000-0000-4000-8000-00000006a404' where id = '00000000-0000-4000-8000-00000006a302';
select throws_ok(
  $$update public.entry_versions set data = '{}' where id = '00000000-0000-4000-8000-00000006a404'$$,
  '42501', null, 'an autosave older than two minutes stays as it was'
);
update public.entries set current_version_id = '00000000-0000-4000-8000-00000006a403' where id = '00000000-0000-4000-8000-00000006a302';

-- ---------------------------------------------------------------------------
-- Editor of A publishes, unpublishes and bins
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000006a002');

select is_empty(
  $$update public.entry_versions set data = '{}' where id = '00000000-0000-4000-8000-00000006a403' returning 1$$,
  'editor cannot overwrite someone else''s autosave'
);
select lives_ok(
  $$update public.entries set status = 'published', published_version_id = '00000000-0000-4000-8000-00000006a403', published_at = now()
    where id = '00000000-0000-4000-8000-00000006a302'$$,
  'editor publishes'
);
select lives_ok(
  $$insert into public.published_content (entry_id, space_id, environment_id, content_type_api_id, full_path, locale, data, published_at)
    select '00000000-0000-4000-8000-00000006a302', space_id, id, 'page', '/about', 'en-GB', '{"title": "About us"}', now()
    from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  'editor writes published content'
);
select isnt_empty(
  $$update public.folders set slug = 'journal' where id = '00000000-0000-4000-8000-00000006a500' returning 1$$,
  'editor renames a folder'
);
select is(
  (select full_path from public.published_content where entry_id = '00000000-0000-4000-8000-00000006a301'),
  '/journal/news/hello',
  'an editor''s rename moves the published pages too'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000006a001');
select throws_ok(
  $$update public.entry_versions set data = '{}' where id = '00000000-0000-4000-8000-00000006a403'$$,
  '42501', null, 'a published autosave stays as it was'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000006a002');
select lives_ok(
  $$delete from public.published_content where entry_id = '00000000-0000-4000-8000-00000006a302'$$,
  'editor removes published content'
);
select lives_ok(
  $$update public.entries set status = 'draft', published_version_id = null, published_at = null, deleted_at = now()
    where id = '00000000-0000-4000-8000-00000006a302'$$,
  'editor unpublishes and bins an entry'
);

-- ---------------------------------------------------------------------------
-- Viewer of A reads but writes nothing
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000006a003');

select isnt_empty($$select 1 from public.entry_versions where space_id = '00000000-0000-4000-8000-00000006a200'$$, 'viewer reads versions');
select throws_ok(
  $$insert into public.entries (space_id, environment_id, content_type_id, slug, locale)
    select space_id, id, page_type_id, 'viewer', 'en-GB' from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  '42501', null, 'viewer cannot add entries'
);
select throws_ok(
  $$insert into public.entry_versions (entry_id, space_id, data, created_by) values
    ('00000000-0000-4000-8000-00000006a300', '00000000-0000-4000-8000-00000006a200', '{}', '00000000-0000-4000-8000-00000006a003')$$,
  '42501', null, 'viewer cannot save versions'
);
select throws_ok(
  $$insert into public.folders (space_id, environment_id, name, slug)
    select space_id, id, 'Viewer', 'viewer' from tests.envs where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  '42501', null, 'viewer cannot add folders'
);

-- ---------------------------------------------------------------------------
-- Agency staff: nothing extra at AAL1, everything at AAL2
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000006c001', 'aal1');

select is_empty(
  $$select 1 from public.entries where space_id in ('00000000-0000-4000-8000-00000006a200', '00000000-0000-4000-8000-00000006b200')$$,
  'staff at AAL1 cannot read client entries'
);
select throws_ok(
  $$insert into public.folders (space_id, environment_id, name, slug)
    select space_id, id, 'Staff', 'staff' from tests.envs where space_id = '00000000-0000-4000-8000-00000006b200'$$,
  '42501', null, 'staff at AAL1 cannot add folders'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000006c001', 'aal2');

select isnt_empty($$select 1 from public.published_content where space_id = '00000000-0000-4000-8000-00000006b200'$$, 'staff at AAL2 read every space');
select lives_ok(
  $$update public.entries set status = 'draft', published_version_id = null, published_at = null
    where id = '00000000-0000-4000-8000-00000006b300'$$,
  'staff at AAL2 unpublish in any space'
);

-- ---------------------------------------------------------------------------
-- anon and missing claims
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$select 1 from public.folders$$, '42501', null, 'anon cannot query folders');
select throws_ok($$select 1 from public.entries$$, '42501', null, 'anon cannot query entries');
select throws_ok($$select 1 from public.entry_versions$$, '42501', null, 'anon cannot query entry versions');
select throws_ok($$select 1 from public.published_content$$, '42501', null, 'anon cannot query published content');

reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000006a001", "role": "authenticated"}', true);
set local role authenticated;
select is_empty($$select 1 from public.entries$$, 'a token without space claims reads no entries');

-- ---------------------------------------------------------------------------
-- Deleting a space removes its versions too
-- ---------------------------------------------------------------------------
reset role;
select lives_ok($$delete from public.spaces where id = '00000000-0000-4000-8000-00000006a200'$$, 'a space with entries can be deleted');
select is_empty(
  $$select 1 from public.entry_versions where space_id = '00000000-0000-4000-8000-00000006a200'$$,
  'its versions are gone with it'
);

select * from finish();
rollback;
