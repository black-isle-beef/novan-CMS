-- Design systems (0024): space-scoped, admins and developers manage them, the upload worker fills in what was
-- processed, and only ready versions are attached. Nothing crosses between spaces.
--
-- Fixture: spaces A and B in separate organisations, each with a ready version of a design system.
--   admin_a  admin of A    editor_a  editor of A    admin_b  admin of B    staff  agency staff
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

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

-- Reads rows as the table owner, whoever the test is acting as.
create function tests.version(id uuid)
returns public.design_system_versions
language sql
security definer
as $$
  select * from public.design_system_versions v where v.id = version.id;
$$;

create function tests.space(space uuid)
returns public.spaces
language sql
security definer
as $$
  select * from public.spaces where id = space;
$$;

grant usage on schema tests to authenticated, anon;
grant execute on function tests.version(uuid), tests.space(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000024a001', 'admin-a@design-systems.test');
select tests.create_user('00000000-0000-4000-8000-00000024a002', 'editor-a@design-systems.test');
select tests.create_user('00000000-0000-4000-8000-00000024b001', 'admin-b@design-systems.test');
select tests.create_user('00000000-0000-4000-8000-00000024c001', 'staff@design-systems.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000024c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000024a100', 'Org A'),
  ('00000000-0000-4000-8000-00000024b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000024a200', '00000000-0000-4000-8000-00000024a100', 'Space A', 'design-systems-a'),
  ('00000000-0000-4000-8000-00000024b200', '00000000-0000-4000-8000-00000024b100', 'Space B', 'design-systems-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000024a200'::uuid, '00000000-0000-4000-8000-00000024a001'::uuid, 'admin'),
    ('00000000-0000-4000-8000-00000024a200'::uuid, '00000000-0000-4000-8000-00000024a002'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000024b200'::uuid, '00000000-0000-4000-8000-00000024b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.design_systems (id, space_id, name, slug, framework)
values
  ('00000000-0000-4000-8000-00000024a300', '00000000-0000-4000-8000-00000024a200', 'Bootstrap', 'bootstrap', 'bootstrap'),
  ('00000000-0000-4000-8000-00000024b300', '00000000-0000-4000-8000-00000024b200', 'Acme', 'acme', 'css');

-- Ready versions, as the worker leaves them; and one of A's still validating.
insert into public.design_system_versions (id, space_id, design_system_id, version, status, source, filename, css_entry)
values
  ('00000000-0000-4000-8000-00000024a400', '00000000-0000-4000-8000-00000024a200', '00000000-0000-4000-8000-00000024a300',
   '5.3.8', 'ready', 'css', 'bootstrap.css', '{bootstrap.css}'),
  ('00000000-0000-4000-8000-00000024a401', '00000000-0000-4000-8000-00000024a200', '00000000-0000-4000-8000-00000024a300',
   '5.4.0', 'validating', 'css', 'bootstrap.css', '{}'),
  ('00000000-0000-4000-8000-00000024b400', '00000000-0000-4000-8000-00000024b200', '00000000-0000-4000-8000-00000024b300',
   '1.0.0', 'ready', 'css', 'acme.css', '{acme.css}');

insert into public.design_system_classes (version_id, space_id, class_name, class_group, source_file)
values
  ('00000000-0000-4000-8000-00000024a400', '00000000-0000-4000-8000-00000024a200', 'btn-primary', 'buttons', 'bootstrap.css'),
  ('00000000-0000-4000-8000-00000024b400', '00000000-0000-4000-8000-00000024b200', 'acme-card', null, 'acme.css');

insert into public.space_design_systems (space_id, environment_id, design_system_id, version_id, load_order)
select space_id, id, '00000000-0000-4000-8000-00000024b300', '00000000-0000-4000-8000-00000024b400', 0
from public.environments where space_id = '00000000-0000-4000-8000-00000024b200' and is_main;

insert into storage.objects (bucket_id, name)
values ('design-systems', 'spaces/00000000-0000-4000-8000-00000024b200/00000000-0000-4000-8000-00000024b300/00000000-0000-4000-8000-00000024b400/files/acme.css');

-- ---------------------------------------------------------------------------
-- The admin of A
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000024a001');

select results_eq(
  $$select slug from public.design_systems$$,
  $$values ('bootstrap')$$,
  'the admin of A reads A''s design systems, not B''s'
);
select is_empty($$select 1 from public.design_system_versions where space_id = '00000000-0000-4000-8000-00000024b200'$$, '... nor B''s versions');
select is_empty($$select 1 from public.design_system_classes where space_id = '00000000-0000-4000-8000-00000024b200'$$, '... nor B''s classes');
select is_empty($$select 1 from public.space_design_systems$$, '... nor B''s attached design systems');
select is_empty(
  $$select 1 from storage.objects where bucket_id = 'design-systems' and name like 'spaces/00000000-0000-4000-8000-00000024b200/%'$$,
  '... nor B''s files'
);

select lives_ok(
  $$insert into public.design_systems (space_id, name, slug, framework, created_by)
    values ('00000000-0000-4000-8000-00000024a200', 'Tokens', 'tokens', 'css', '00000000-0000-4000-8000-00000024a001')$$,
  'the admin of A adds a design system to A'
);
select throws_ok(
  $$insert into public.design_systems (space_id, name, slug, framework, created_by)
    values ('00000000-0000-4000-8000-00000024b200', 'Sneaky', 'sneaky', 'css', '00000000-0000-4000-8000-00000024a001')$$,
  '42501', null, '... but not to B'
);
select is_empty(
  $$update public.design_systems set name = 'Mine' where space_id = '00000000-0000-4000-8000-00000024b200' returning 1$$,
  '... and cannot rename B''s'
);

select lives_ok(
  $$insert into public.design_system_versions (id, space_id, design_system_id, version, source, filename, created_by)
    values ('00000000-0000-4000-8000-00000024a402', '00000000-0000-4000-8000-00000024a200', '00000000-0000-4000-8000-00000024a300',
            '6.0.0', 'css', 'bootstrap.css', '00000000-0000-4000-8000-00000024a001')$$,
  'the admin of A uploads a new version'
);
select throws_ok(
  $$insert into public.design_system_versions (space_id, design_system_id, version, status, source, filename, created_by)
    values ('00000000-0000-4000-8000-00000024a200', '00000000-0000-4000-8000-00000024a300', '6.1.0', 'ready', 'css', 'b.css',
            '00000000-0000-4000-8000-00000024a001')$$,
  '42501', null, '... but cannot add one as ready'
);
select throws_ok(
  $$insert into public.design_system_versions (space_id, design_system_id, version, source, filename, created_by)
    values ('00000000-0000-4000-8000-00000024a200', '00000000-0000-4000-8000-00000024b300', '6.1.0', 'css', 'b.css',
            '00000000-0000-4000-8000-00000024a001')$$,
  '23503', null, '... nor to B''s design system'
);
select lives_ok(
  $$update public.design_system_versions set status = 'validating' where id = '00000000-0000-4000-8000-00000024a402'$$,
  '... marks the upload complete'
);
select throws_ok(
  $$update public.design_system_versions set status = 'ready' where id = '00000000-0000-4000-8000-00000024a402'$$,
  '42501', null, '... but cannot make it ready'
);
select throws_ok(
  $$update public.design_system_versions set css_entry = '{evil.css}' where id = '00000000-0000-4000-8000-00000024a402'$$,
  '42501', null, '... nor change what was processed'
);
select throws_ok(
  $$delete from public.design_system_versions where id = '00000000-0000-4000-8000-00000024a402'$$,
  '42501', null, '... nor delete a version'
);
select throws_ok(
  $$insert into public.design_system_classes (version_id, space_id, class_name, source_file)
    values ('00000000-0000-4000-8000-00000024a400', '00000000-0000-4000-8000-00000024a200', 'fake', 'x.css')$$,
  '42501', null, '... nor write the class index'
);

select lives_ok(
  $$insert into public.space_design_systems (space_id, environment_id, design_system_id, version_id, load_order)
    select space_id, id, '00000000-0000-4000-8000-00000024a300', '00000000-0000-4000-8000-00000024a400', 0
    from public.environments where space_id = '00000000-0000-4000-8000-00000024a200' and is_main$$,
  'the admin of A attaches a ready version to A''s site'
);
select throws_ok(
  $$update public.space_design_systems set version_id = '00000000-0000-4000-8000-00000024a401'
    where version_id = '00000000-0000-4000-8000-00000024a400'$$,
  '23514', null, '... but not one still being checked'
);
select throws_ok(
  $$insert into public.space_design_systems (space_id, environment_id, design_system_id, version_id, load_order)
    select space_id, id, '00000000-0000-4000-8000-00000024b300', '00000000-0000-4000-8000-00000024b400', 1
    from public.environments where space_id = '00000000-0000-4000-8000-00000024a200' and is_main$$,
  '23503', null, '... nor B''s version'
);
select lives_ok(
  $$update public.design_system_versions set status = 'deprecated' where id = '00000000-0000-4000-8000-00000024a400'$$,
  '... deprecates a ready version, which stays attached'
);
select throws_ok(
  $$update public.spaces set settings = settings || '{"designSystems": {"enabled": true}}' where id = '00000000-0000-4000-8000-00000024a200'$$,
  '42501', null, '... and cannot turn design systems on for A'
);

-- ---------------------------------------------------------------------------
-- An editor of A reads, and changes nothing
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000024a002');
select isnt_empty($$select 1 from public.design_system_classes where class_name = 'btn-primary'$$, 'an editor of A reads A''s classes');
select throws_ok(
  $$insert into public.design_systems (space_id, name, slug, framework, created_by)
    values ('00000000-0000-4000-8000-00000024a200', 'Mine', 'mine', 'css', '00000000-0000-4000-8000-00000024a002')$$,
  '42501', null, '... but does not add design systems'
);
select is_empty($$delete from public.space_design_systems returning 1$$, '... nor detach them');

-- ---------------------------------------------------------------------------
-- The worker (service connection): even it cannot change a ready version's files
-- ---------------------------------------------------------------------------
reset role;
select throws_ok(
  $$update public.design_system_versions set css_entry = '{other.css}' where id = '00000000-0000-4000-8000-00000024b400'$$,
  '23514', null, 'a ready version''s files never change'
);
select lives_ok(
  $$update public.design_system_versions set status = 'ready', css_entry = '{bootstrap.css}',
      validation_report = '{"errors": [], "warnings": []}', processed_at = now()
    where id = '00000000-0000-4000-8000-00000024a401'$$,
  'the worker marks a checked version ready'
);

-- ---------------------------------------------------------------------------
-- Agency staff, at AAL2 only, turn the feature on
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000024c001', 'aal2');
select lives_ok(
  $$update public.spaces set settings = settings || '{"designSystems": {"enabled": true}}' where id = '00000000-0000-4000-8000-00000024b200'$$,
  'agency staff turn design systems on for a space'
);
select is(
  (tests.space('00000000-0000-4000-8000-00000024b200')).settings #> '{designSystems,enabled}', 'true'::jsonb,
  '... and the setting is stored'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$select 1 from public.design_systems$$, '42501', null, 'anon reads no design systems');
select throws_ok($$select 1 from public.space_design_systems$$, '42501', null, '... and no attachments');

reset role;
select ok(exists (select 1 from pgmq.list_queues() where queue_name = 'design-systems'), 'the design-systems queue exists');

select * from finish();
rollback;
