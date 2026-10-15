-- Media settings of a space (0023): only agency staff, with a second factor, change `spaces.settings.media`.
--
-- Fixture: spaces A and B in separate organisations.
--   admin_a  admin of A    admin_b  admin of B    staff  agency staff
-- Space admins still rename their space and change its site address, but not its media settings, and never
-- another space's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

-- Reads a space as the table owner, whoever the test is acting as.
create function tests.space(space uuid)
returns public.spaces
language sql
security definer
as $$
  select * from public.spaces where id = space;
$$;

grant usage on schema tests to authenticated, anon;
grant execute on function tests.space(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000023a001', 'admin-a@media-settings.test');
select tests.create_user('00000000-0000-4000-8000-00000023b001', 'admin-b@media-settings.test');
select tests.create_user('00000000-0000-4000-8000-00000023c001', 'staff@media-settings.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000023c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000023a100', 'Org A'),
  ('00000000-0000-4000-8000-00000023b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug, settings)
values
  ('00000000-0000-4000-8000-00000023a200', '00000000-0000-4000-8000-00000023a100', 'Space A', 'media-settings-a', '{}'),
  ('00000000-0000-4000-8000-00000023b200', '00000000-0000-4000-8000-00000023b100', 'Space B', 'media-settings-b', '{}');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000023a200'::uuid, '00000000-0000-4000-8000-00000023a001'::uuid, 'admin'),
    ('00000000-0000-4000-8000-00000023b200'::uuid, '00000000-0000-4000-8000-00000023b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

-- ---------------------------------------------------------------------------
-- The admin of A
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000023a001');

select throws_ok(
  $$update public.spaces set settings = settings || '{"media": {"allowSvg": true}}' where id = '00000000-0000-4000-8000-00000023a200'$$,
  '42501', null, 'a space admin cannot allow SVG in their space'
);

select lives_ok(
  $$update public.spaces set name = 'Space A renamed', preview_url = 'https://a.example' where id = '00000000-0000-4000-8000-00000023a200'$$,
  '... but still renames it and changes its site address'
);
select is((tests.space('00000000-0000-4000-8000-00000023a200')).name, 'Space A renamed', '... and the change is kept');

select lives_ok(
  $$update public.spaces set settings = settings || '{"other": 1}' where id = '00000000-0000-4000-8000-00000023a200'$$,
  '... and other settings are not guarded'
);

-- Cross-tenant: RLS hides B from A's admin, so the update reaches no row.
update public.spaces set settings = '{"media": {"allowSvg": true}}' where id = '00000000-0000-4000-8000-00000023b200';
select is(
  (tests.space('00000000-0000-4000-8000-00000023b200')).settings -> 'media', null,
  'the admin of A cannot change the media settings of B'
);

-- ---------------------------------------------------------------------------
-- Agency staff, at AAL2 only
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000023c001', 'aal1');
-- Without a second factor, staff are not staff: RLS hides B, so the update reaches no row.
update public.spaces set settings = settings || '{"media": {"allowSvg": true}}' where id = '00000000-0000-4000-8000-00000023b200';
select is(
  (tests.space('00000000-0000-4000-8000-00000023b200')).settings -> 'media', null,
  'agency staff without a second factor cannot allow SVG'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000023c001', 'aal2');
select lives_ok(
  $$update public.spaces set settings = settings || '{"media": {"allowSvg": true}}' where id = '00000000-0000-4000-8000-00000023b200'$$,
  'agency staff allow SVG in any space'
);
select is(
  (tests.space('00000000-0000-4000-8000-00000023b200')).settings #> '{media,allowSvg}', 'true'::jsonb,
  '... and the setting is stored'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok(
  $$update public.spaces set settings = '{}' where id = '00000000-0000-4000-8000-00000023b200'$$,
  '42501', null, 'anon cannot change the media settings'
);

select * from finish();
rollback;
