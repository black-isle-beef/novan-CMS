-- Content model (package 05): constraints and row-level security for content_types and block_types.
--
-- Fixture: spaces A and B in separate organisations, each with a content type and a block type in `main`.
--   admin_a  admin of A    developer_a  developer of A    editor_a  editor of A    admin_b  admin of B
--   staff    agency staff, member of nothing (privileged only at AAL2)
-- A member of A can neither read nor write B's content model; in A, only admins and developers write.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

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
select tests.create_user('00000000-0000-4000-8000-00000005a001', 'admin-a@model.test');
select tests.create_user('00000000-0000-4000-8000-00000005a002', 'developer-a@model.test');
select tests.create_user('00000000-0000-4000-8000-00000005a003', 'editor-a@model.test');
select tests.create_user('00000000-0000-4000-8000-00000005b001', 'admin-b@model.test');
select tests.create_user('00000000-0000-4000-8000-00000005c001', 'staff@model.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000005c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000005a100', 'Org A'),
  ('00000000-0000-4000-8000-00000005b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000005a200', '00000000-0000-4000-8000-00000005a100', 'Space A', 'model-a'),
  ('00000000-0000-4000-8000-00000005b200', '00000000-0000-4000-8000-00000005b100', 'Space B', 'model-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000005a200'::uuid, '00000000-0000-4000-8000-00000005a001'::uuid, 'admin'),
    ('00000000-0000-4000-8000-00000005a200'::uuid, '00000000-0000-4000-8000-00000005a002'::uuid, 'developer'),
    ('00000000-0000-4000-8000-00000005a200'::uuid, '00000000-0000-4000-8000-00000005a003'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000005b200'::uuid, '00000000-0000-4000-8000-00000005b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

-- Each space's main environment, for inserts below (RLS-free fixture table, readable by tests).
create table tests.envs as
select space_id, id from public.environments
where space_id in ('00000000-0000-4000-8000-00000005a200', '00000000-0000-4000-8000-00000005b200') and is_main;
grant usage on schema tests to authenticated;
grant select on tests.envs to authenticated;

insert into public.content_types (space_id, environment_id, api_id, name, kind)
select space_id, id, 'page', 'Page', 'page' from tests.envs;

insert into public.block_types (space_id, environment_id, api_id, name)
select space_id, id, 'hero', 'Hero' from tests.envs;

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.content_types (space_id, environment_id, api_id, name, kind)
    select space_id, id, 'post', 'Post', 'blog' from tests.envs where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  '23514', null, 'kind must be page, entry or singleton'
);
select throws_ok(
  $$insert into public.content_types (space_id, environment_id, api_id, name, kind)
    select space_id, id, 'page', 'Page again', 'page' from tests.envs where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  '23505', null, 'api_id is unique per environment'
);
select throws_ok(
  $$insert into public.block_types (space_id, environment_id, api_id, name)
    select space_id, id, 'Hero Banner', 'Hero' from tests.envs where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  '23514', null, 'api_id must be camelCase'
);
select throws_ok(
  $$insert into public.content_types (space_id, environment_id, api_id, name, kind, fields)
    select space_id, id, 'post', 'Post', 'entry', '{}' from tests.envs where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  '23514', null, 'fields must be a JSON array'
);
select throws_ok(
  $$insert into public.block_types (space_id, environment_id, api_id, name, style_options)
    select space_id, id, 'cta', 'CTA', '[]' from tests.envs where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  '23514', null, 'style_options must be a JSON object'
);
-- A's content type cannot point at B's environment.
select throws_ok(
  $$insert into public.content_types (space_id, environment_id, api_id, name, kind)
    select '00000000-0000-4000-8000-00000005a200', id, 'post', 'Post', 'entry'
    from tests.envs where space_id = '00000000-0000-4000-8000-00000005b200'$$,
  '23503', null, 'a content type''s environment must be in the same space'
);
select throws_ok(
  $$insert into public.block_types (space_id, environment_id, api_id, name)
    select '00000000-0000-4000-8000-00000005a200', id, 'cta', 'CTA'
    from tests.envs where space_id = '00000000-0000-4000-8000-00000005b200'$$,
  '23503', null, 'a block type''s environment must be in the same space'
);

insert into public.environments (space_id, name) values ('00000000-0000-4000-8000-00000005a200', 'staging');
select lives_ok(
  $$insert into public.content_types (space_id, environment_id, api_id, name, kind)
    select space_id, id, 'page', 'Page', 'page' from public.environments
    where space_id = '00000000-0000-4000-8000-00000005a200' and name = 'staging'$$,
  'the same api_id can exist in another environment'
);
select lives_ok(
  $$delete from public.environments where space_id = '00000000-0000-4000-8000-00000005a200' and name = 'staging'$$,
  'deleting an environment deletes its content model'
);
select is_empty(
  $$select 1 from public.content_types ct join public.environments e on e.id = ct.environment_id
    where e.space_id = '00000000-0000-4000-8000-00000005a200' and e.name = 'staging'$$,
  'no content types are left in a deleted environment'
);

update public.block_types set created_at = now() - interval '1 day', updated_at = now() - interval '1 day';
update public.block_types set name = 'Hero banner' where space_id = '00000000-0000-4000-8000-00000005a200';
select ok(
  (select updated_at = now() and created_at < now() from public.block_types where space_id = '00000000-0000-4000-8000-00000005a200'),
  'updates set updated_at'
);

-- ---------------------------------------------------------------------------
-- Admin of A cannot read or write B
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000005a001');

select is_empty($$select 1 from public.content_types where space_id = '00000000-0000-4000-8000-00000005b200'$$, 'A cannot read B''s content types');
select is_empty($$select 1 from public.block_types where space_id = '00000000-0000-4000-8000-00000005b200'$$, 'A cannot read B''s block types');
select isnt_empty($$select 1 from public.content_types where space_id = '00000000-0000-4000-8000-00000005a200'$$, 'A reads its content types');
select isnt_empty($$select 1 from public.block_types where space_id = '00000000-0000-4000-8000-00000005a200'$$, 'A reads its block types');

select throws_ok(
  $$insert into public.content_types (space_id, environment_id, api_id, name, kind)
    select space_id, id, 'rogue', 'Rogue', 'entry' from tests.envs where space_id = '00000000-0000-4000-8000-00000005b200'$$,
  '42501', null, 'A cannot insert content types into B'
);
select throws_ok(
  $$insert into public.block_types (space_id, environment_id, api_id, name)
    select space_id, id, 'rogue', 'Rogue' from tests.envs where space_id = '00000000-0000-4000-8000-00000005b200'$$,
  '42501', null, 'A cannot insert block types into B'
);
select is_empty($$update public.content_types set name = 'x' where space_id = '00000000-0000-4000-8000-00000005b200' returning 1$$, 'A cannot update B''s content types');
select is_empty($$update public.block_types set fields = '[]' where space_id = '00000000-0000-4000-8000-00000005b200' returning 1$$, 'A cannot update B''s block types');
select is_empty($$delete from public.content_types where space_id = '00000000-0000-4000-8000-00000005b200' returning 1$$, 'A cannot delete B''s content types');
select is_empty($$delete from public.block_types where space_id = '00000000-0000-4000-8000-00000005b200' returning 1$$, 'A cannot delete B''s block types');
select throws_ok(
  $$update public.content_types set space_id = '00000000-0000-4000-8000-00000005b200' where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  '42501', null, 'A cannot move its content types into B'
);

select lives_ok(
  $$insert into public.content_types (space_id, environment_id, api_id, name, kind)
    select space_id, id, 'article', 'Article', 'entry' from tests.envs where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  'A admin adds a content type to A'
);

-- ---------------------------------------------------------------------------
-- Developer of A models A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000005a002');

select lives_ok(
  $$insert into public.block_types (space_id, environment_id, api_id, name, allowed_children)
    select space_id, id, 'columns', 'Columns', '{hero}' from tests.envs where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  'A developer adds a block type to A'
);
select isnt_empty(
  $$update public.content_types set fields = '[{"id": "t", "apiId": "title", "label": "Title", "type": "text"}]'
    where space_id = '00000000-0000-4000-8000-00000005a200' and api_id = 'article' returning 1$$,
  'A developer changes a content type''s fields'
);
select isnt_empty(
  $$delete from public.block_types where space_id = '00000000-0000-4000-8000-00000005a200' and api_id = 'columns' returning 1$$,
  'A developer deletes a block type'
);
select is_empty($$select 1 from public.content_types where space_id = '00000000-0000-4000-8000-00000005b200'$$, 'A developer cannot read B');

-- ---------------------------------------------------------------------------
-- Editor of A reads A's model but cannot change it
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000005a003');

select isnt_empty($$select 1 from public.content_types where space_id = '00000000-0000-4000-8000-00000005a200'$$, 'editor reads content types');
select isnt_empty($$select 1 from public.block_types where space_id = '00000000-0000-4000-8000-00000005a200'$$, 'editor reads block types');
select throws_ok(
  $$insert into public.content_types (space_id, environment_id, api_id, name, kind)
    select space_id, id, 'editorType', 'Editor type', 'entry' from tests.envs where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  '42501', null, 'editor cannot add content types'
);
select throws_ok(
  $$insert into public.block_types (space_id, environment_id, api_id, name)
    select space_id, id, 'editorBlock', 'Editor block' from tests.envs where space_id = '00000000-0000-4000-8000-00000005a200'$$,
  '42501', null, 'editor cannot add block types'
);
select is_empty($$update public.content_types set name = 'x' where space_id = '00000000-0000-4000-8000-00000005a200' returning 1$$, 'editor cannot change content types');
select is_empty($$delete from public.block_types where space_id = '00000000-0000-4000-8000-00000005a200' returning 1$$, 'editor cannot delete block types');

-- ---------------------------------------------------------------------------
-- Agency staff: nothing extra at AAL1, everything at AAL2
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000005c001', 'aal1');

select is_empty(
  $$select 1 from public.content_types where space_id in ('00000000-0000-4000-8000-00000005a200', '00000000-0000-4000-8000-00000005b200')$$,
  'staff at AAL1 cannot read client content types'
);
select throws_ok(
  $$insert into public.block_types (space_id, environment_id, api_id, name)
    select space_id, id, 'staffBlock', 'Staff block' from tests.envs where space_id = '00000000-0000-4000-8000-00000005b200'$$,
  '42501', null, 'staff at AAL1 cannot add block types'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000005c001', 'aal2');

select isnt_empty($$select 1 from public.content_types where space_id = '00000000-0000-4000-8000-00000005b200'$$, 'staff at AAL2 read every content type');
select lives_ok(
  $$insert into public.block_types (space_id, environment_id, api_id, name)
    select space_id, id, 'staffBlock', 'Staff block' from tests.envs where space_id = '00000000-0000-4000-8000-00000005b200'$$,
  'staff at AAL2 add block types to any space'
);

-- ---------------------------------------------------------------------------
-- anon and missing claims
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$select 1 from public.content_types$$, '42501', null, 'anon cannot query content types');
select throws_ok($$select 1 from public.block_types$$, '42501', null, 'anon cannot query block types');

reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000005a001", "role": "authenticated"}', true);
set local role authenticated;
select is_empty($$select 1 from public.content_types$$, 'a token without space claims reads no content types');

reset role;
select * from finish();
rollback;
