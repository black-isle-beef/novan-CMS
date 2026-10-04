-- Assets (package 07): constraints, triggers and row-level security for assets, asset_usages and the
-- `media` storage bucket.
--
-- Fixture: spaces A and B in separate organisations, each with a `home` entry, one asset used on it and
-- the asset's file in the bucket. A also has an asset uploaded by its editor.
--   author_a  author of A    editor_a  editor of A    viewer_a  viewer of A    admin_b  admin of B
--   staff     agency staff, member of nothing (privileged only at AAL2)
-- A member of A can neither read nor write B's assets, usages or files. In A, authors upload and
-- describe their own files, only editors replace files or use the bin, and nobody writes to the bucket
-- except the API's service role.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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
select tests.create_user('00000000-0000-4000-8000-00000007a001', 'author-a@assets.test');
select tests.create_user('00000000-0000-4000-8000-00000007a002', 'editor-a@assets.test');
select tests.create_user('00000000-0000-4000-8000-00000007a003', 'viewer-a@assets.test');
select tests.create_user('00000000-0000-4000-8000-00000007b001', 'admin-b@assets.test');
select tests.create_user('00000000-0000-4000-8000-00000007c001', 'staff@assets.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000007c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000007a100', 'Org A'),
  ('00000000-0000-4000-8000-00000007b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000007a200', '00000000-0000-4000-8000-00000007a100', 'Space A', 'assets-a'),
  ('00000000-0000-4000-8000-00000007b200', '00000000-0000-4000-8000-00000007b100', 'Space B', 'assets-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000007a200'::uuid, '00000000-0000-4000-8000-00000007a001'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000007a200'::uuid, '00000000-0000-4000-8000-00000007a002'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000007a200'::uuid, '00000000-0000-4000-8000-00000007a003'::uuid, 'viewer'),
    ('00000000-0000-4000-8000-00000007b200'::uuid, '00000000-0000-4000-8000-00000007b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

-- A `home` entry in each space, for usages.
insert into public.content_types (space_id, environment_id, api_id, name, kind)
select space_id, id, 'page', 'Page', 'page' from public.environments
where space_id in ('00000000-0000-4000-8000-00000007a200', '00000000-0000-4000-8000-00000007b200') and is_main;

insert into public.entries (id, space_id, environment_id, content_type_id, slug, locale)
select
  case when e.space_id = '00000000-0000-4000-8000-00000007a200'
    then '00000000-0000-4000-8000-00000007a300'::uuid else '00000000-0000-4000-8000-00000007b300'::uuid end,
  e.space_id, e.id, ct.id, 'home', 'en-GB'
from public.environments e
join public.content_types ct on ct.environment_id = e.id
where e.space_id in ('00000000-0000-4000-8000-00000007a200', '00000000-0000-4000-8000-00000007b200') and e.is_main;

insert into public.assets (id, space_id, path, filename, mime, size_bytes, width, height, uploaded_by)
values
  ('00000000-0000-4000-8000-00000007a400', '00000000-0000-4000-8000-00000007a200',
   'spaces/00000000-0000-4000-8000-00000007a200/00000000-0000-4000-8000-00000007a400/cat.jpg',
   'cat.jpg', 'image/jpeg', 1000, 800, 600, '00000000-0000-4000-8000-00000007a001'),
  ('00000000-0000-4000-8000-00000007a401', '00000000-0000-4000-8000-00000007a200',
   'spaces/00000000-0000-4000-8000-00000007a200/00000000-0000-4000-8000-00000007a401/dog.jpg',
   'dog.jpg', 'image/jpeg', 1000, 800, 600, '00000000-0000-4000-8000-00000007a002'),
  ('00000000-0000-4000-8000-00000007b400', '00000000-0000-4000-8000-00000007b200',
   'spaces/00000000-0000-4000-8000-00000007b200/00000000-0000-4000-8000-00000007b400/secret.pdf',
   'secret.pdf', 'application/pdf', 1000, null, null, '00000000-0000-4000-8000-00000007b001');

insert into public.asset_usages (asset_id, entry_id, space_id, field_path)
values
  ('00000000-0000-4000-8000-00000007a400', '00000000-0000-4000-8000-00000007a300', '00000000-0000-4000-8000-00000007a200', 'image'),
  ('00000000-0000-4000-8000-00000007b400', '00000000-0000-4000-8000-00000007b300', '00000000-0000-4000-8000-00000007b200', 'file');

insert into storage.objects (bucket_id, name)
values
  ('media', 'spaces/00000000-0000-4000-8000-00000007a200/00000000-0000-4000-8000-00000007a400/cat.jpg'),
  ('media', 'spaces/00000000-0000-4000-8000-00000007b200/00000000-0000-4000-8000-00000007b400/secret.pdf');

-- ---------------------------------------------------------------------------
-- Bucket and constraints
-- ---------------------------------------------------------------------------
select is(
  (select public from storage.buckets where id = 'media'),
  false,
  'the media bucket is private'
);
select ok(
  not (select 'text/html' = any(allowed_mime_types) from storage.buckets where id = 'media'),
  'the media bucket refuses HTML'
);
select throws_ok(
  $$insert into public.assets (space_id, path, filename, mime, size_bytes)
    values ('00000000-0000-4000-8000-00000007a200', 'spaces/00000000-0000-4000-8000-00000007b200/x/cat.jpg', 'cat.jpg', 'image/jpeg', 1)$$,
  '23514', null, 'an asset''s path is under its own space and id'
);
select throws_ok(
  $$insert into public.assets (id, space_id, path, filename, mime, size_bytes)
    values ('00000000-0000-4000-8000-00000007a499', '00000000-0000-4000-8000-00000007a200',
      'spaces/00000000-0000-4000-8000-00000007a200/00000000-0000-4000-8000-00000007a499/../cat.jpg', '../cat.jpg', 'image/jpeg', 1)$$,
  '23514', null, 'filenames cannot climb out of their folder'
);
select throws_ok(
  $$update public.assets set focal_x = 0.5 where id = '00000000-0000-4000-8000-00000007a400'$$,
  '23514', null, 'a focal point has both coordinates'
);
select throws_ok(
  $$update public.assets set folder = '/Brand' where id = '00000000-0000-4000-8000-00000007a400'$$,
  '23514', null, 'folders are written like Brand/Logos'
);
select throws_ok(
  $$update public.assets set space_id = '00000000-0000-4000-8000-00000007b200' where id = '00000000-0000-4000-8000-00000007a400'$$,
  '23514', null, 'an asset cannot change space'
);
select throws_ok(
  $$insert into public.asset_usages (asset_id, entry_id, space_id, field_path)
    values ('00000000-0000-4000-8000-00000007a400', '00000000-0000-4000-8000-00000007b300', '00000000-0000-4000-8000-00000007a200', 'image')$$,
  '23503', null, 'an asset is only used by entries of its own space'
);

-- ---------------------------------------------------------------------------
-- Author of A cannot read or write B
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000007a001');
-- Storage blocks SQL deletes unless this is set, as the Storage API does; with it, RLS decides.
select set_config('storage.allow_delete_query', 'true', true);

select is_empty($$select 1 from public.assets where space_id = '00000000-0000-4000-8000-00000007b200'$$, 'A cannot read B''s assets');
select is_empty($$select 1 from public.asset_usages where space_id = '00000000-0000-4000-8000-00000007b200'$$, 'A cannot read B''s asset usages');
select is_empty(
  $$select 1 from storage.objects where bucket_id = 'media' and name like 'spaces/00000000-0000-4000-8000-00000007b200/%'$$,
  'A cannot read B''s files'
);
select isnt_empty($$select 1 from public.assets where space_id = '00000000-0000-4000-8000-00000007a200'$$, 'A reads its own assets');
select isnt_empty(
  $$select 1 from storage.objects where bucket_id = 'media' and name like 'spaces/00000000-0000-4000-8000-00000007a200/%'$$,
  'A reads its own files'
);

select throws_ok(
  $$insert into public.assets (id, space_id, path, filename, mime, size_bytes, uploaded_by)
    values ('00000000-0000-4000-8000-00000007b499', '00000000-0000-4000-8000-00000007b200',
      'spaces/00000000-0000-4000-8000-00000007b200/00000000-0000-4000-8000-00000007b499/rogue.jpg', 'rogue.jpg', 'image/jpeg', 1,
      '00000000-0000-4000-8000-00000007a001')$$,
  '42501', null, 'A cannot add assets to B'
);
select is_empty(
  $$update public.assets set alt = 'Taken' where space_id = '00000000-0000-4000-8000-00000007b200' returning 1$$,
  'A cannot update B''s assets'
);
select throws_ok(
  $$insert into public.asset_usages (asset_id, entry_id, space_id, field_path)
    values ('00000000-0000-4000-8000-00000007b400', '00000000-0000-4000-8000-00000007b300', '00000000-0000-4000-8000-00000007b200', 'x')$$,
  '42501', null, 'A cannot record usages in B'
);
select is_empty(
  $$delete from public.asset_usages where space_id = '00000000-0000-4000-8000-00000007b200' returning 1$$,
  'A cannot remove B''s usages'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('media', 'spaces/00000000-0000-4000-8000-00000007b200/00000000-0000-4000-8000-00000007b400/rogue.html')$$,
  '42501', null, 'A cannot put files in B''s folder'
);
select is_empty(
  $$delete from storage.objects where bucket_id = 'media' and name like 'spaces/00000000-0000-4000-8000-00000007b200/%' returning 1$$,
  'A cannot delete B''s files'
);

-- ---------------------------------------------------------------------------
-- Author of A: uploads and describes their own files; cannot replace, bin, or write the bucket
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.assets (id, space_id, path, filename, mime, size_bytes, uploaded_by)
    values ('00000000-0000-4000-8000-00000007a402', '00000000-0000-4000-8000-00000007a200',
      'spaces/00000000-0000-4000-8000-00000007a200/00000000-0000-4000-8000-00000007a402/new.png', 'new.png', 'image/png', 1,
      '00000000-0000-4000-8000-00000007a001')$$,
  'an author adds an asset as themselves'
);
select throws_ok(
  $$insert into public.assets (id, space_id, path, filename, mime, size_bytes, uploaded_by)
    values ('00000000-0000-4000-8000-00000007a403', '00000000-0000-4000-8000-00000007a200',
      'spaces/00000000-0000-4000-8000-00000007a200/00000000-0000-4000-8000-00000007a403/new.png', 'new.png', 'image/png', 1,
      '00000000-0000-4000-8000-00000007a002')$$,
  '42501', null, 'an author cannot add an asset as someone else'
);
select lives_ok(
  $$update public.assets set alt = 'A ginger cat', title = 'Cat', tags = '{pets}', folder = 'Animals/Cats', focal_x = 0.3, focal_y = 0.6
    where id = '00000000-0000-4000-8000-00000007a400'$$,
  'an author describes a file they uploaded'
);
select is(
  (select alt from public.assets where id = '00000000-0000-4000-8000-00000007a400'),
  'A ginger cat',
  'the description is saved'
);
select is_empty(
  $$update public.assets set alt = 'A dog' where id = '00000000-0000-4000-8000-00000007a401' returning 1$$,
  'an author cannot describe a file someone else uploaded'
);
select throws_ok(
  $$update public.assets set revision = revision + 1, mime = 'image/png' where id = '00000000-0000-4000-8000-00000007a400'$$,
  '42501', null, 'an author cannot replace a file'
);
select throws_ok(
  $$update public.assets set deleted_at = now() where id = '00000000-0000-4000-8000-00000007a400'$$,
  '42501', null, 'an author cannot put a file in the bin'
);
select throws_ok(
  $$delete from public.assets where id = '00000000-0000-4000-8000-00000007a400'$$,
  '42501', null, 'nobody deletes asset rows (the bin is purged by a job)'
);
select throws_ok(
  $$insert into public.asset_usages (asset_id, entry_id, space_id, field_path)
    values ('00000000-0000-4000-8000-00000007a401', '00000000-0000-4000-8000-00000007a300', '00000000-0000-4000-8000-00000007a200', 'x')$$,
  '42501', null, 'an author cannot record usages (publishing needs an editor)'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('media', 'spaces/00000000-0000-4000-8000-00000007a200/00000000-0000-4000-8000-00000007a400/direct.jpg')$$,
  '42501', null, 'members cannot write to the bucket directly, even in their own space'
);
select is_empty(
  $$update storage.objects set name = name || '.bak' where bucket_id = 'media' returning 1$$,
  'members cannot rename files in the bucket'
);
select is_empty(
  $$delete from storage.objects where bucket_id = 'media' returning 1$$,
  'members cannot delete files from the bucket'
);

-- ---------------------------------------------------------------------------
-- Viewer of A reads only
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000007a003');

select isnt_empty($$select 1 from public.assets where space_id = '00000000-0000-4000-8000-00000007a200'$$, 'a viewer reads the library');
select is_empty(
  $$update public.assets set alt = 'Viewer' where space_id = '00000000-0000-4000-8000-00000007a200' returning 1$$,
  'a viewer cannot describe files'
);
select throws_ok(
  $$insert into public.assets (id, space_id, path, filename, mime, size_bytes, uploaded_by)
    values ('00000000-0000-4000-8000-00000007a404', '00000000-0000-4000-8000-00000007a200',
      'spaces/00000000-0000-4000-8000-00000007a200/00000000-0000-4000-8000-00000007a404/v.png', 'v.png', 'image/png', 1,
      '00000000-0000-4000-8000-00000007a003')$$,
  '42501', null, 'a viewer cannot upload'
);

-- ---------------------------------------------------------------------------
-- Editor of A replaces, bins and records usages
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000007a002');

select lives_ok(
  $$update public.assets set alt = 'A brown dog' where id = '00000000-0000-4000-8000-00000007a401'$$,
  'an editor describes any file'
);
select lives_ok(
  $$update public.assets set revision = revision + 1, size_bytes = 2000 where id = '00000000-0000-4000-8000-00000007a400'$$,
  'an editor replaces a file'
);
select lives_ok(
  $$update public.assets set deleted_at = now() where id = '00000000-0000-4000-8000-00000007a402'$$,
  'an editor puts a file in the bin'
);
select lives_ok(
  $$insert into public.asset_usages (asset_id, entry_id, space_id, field_path)
    values ('00000000-0000-4000-8000-00000007a401', '00000000-0000-4000-8000-00000007a300', '00000000-0000-4000-8000-00000007a200', 'body.x.image')$$,
  'an editor records a usage when publishing'
);
select isnt_empty(
  $$delete from public.asset_usages where entry_id = '00000000-0000-4000-8000-00000007a300' returning 1$$,
  'an editor removes usages when unpublishing'
);
select is_empty($$select 1 from public.assets where space_id = '00000000-0000-4000-8000-00000007b200'$$, 'an editor of A still cannot read B''s assets');

-- ---------------------------------------------------------------------------
-- Admin of B: the mirror image
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000007b001');

select is_empty(
  $$select 1 from storage.objects where bucket_id = 'media' and name like 'spaces/00000000-0000-4000-8000-00000007a200/%'$$,
  'B cannot read A''s files'
);
select is_empty($$select 1 from public.assets where space_id = '00000000-0000-4000-8000-00000007a200'$$, 'B cannot read A''s assets');

-- ---------------------------------------------------------------------------
-- Agency staff: nothing without a second factor, everything with one
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000007c001');
select is_empty($$select 1 from public.assets where space_id = '00000000-0000-4000-8000-00000007b200'$$, 'staff at AAL1 read no assets');

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000007c001', 'aal2');
select isnt_empty($$select 1 from public.assets where space_id = '00000000-0000-4000-8000-00000007b200'$$, 'staff at AAL2 read any space''s assets');
select isnt_empty(
  $$select 1 from storage.objects where bucket_id = 'media' and name like 'spaces/00000000-0000-4000-8000-00000007b200/%'$$,
  'staff at AAL2 read any space''s files'
);

-- ---------------------------------------------------------------------------
-- Anonymous visitors see nothing
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select 1 from public.assets$$, '42501', null, 'anon cannot read assets');
select is_empty($$select 1 from storage.objects where bucket_id = 'media'$$, 'anon cannot read the bucket');

select * from finish();
rollback;
