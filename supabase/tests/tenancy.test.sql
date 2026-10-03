-- Tenant isolation (package 03): the access token hook, claim helpers and RLS policies.
--
-- Fixture: spaces A and B in separate organisations.
--   admin_a  admin of A        viewer_a  viewer of A        admin_b  admin of B
--   staff    agency staff, member of nothing (privileged only at AAL2)
-- For every tenancy table, a member of A can neither read nor write B's rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(85);

-- ---------------------------------------------------------------------------
-- Helpers (equivalents of basejump-supabase_test_helpers), rolled back with the test.
-- ---------------------------------------------------------------------------
create schema tests;

-- Become `user_id` exactly as PostgREST would: role `authenticated` and the claims the access
-- token hook issues. Call it as postgres (`reset role` first when switching users).
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
select tests.create_user('00000000-0000-4000-8000-00000000a001', 'admin-a@tenancy.test');
select tests.create_user('00000000-0000-4000-8000-00000000a002', 'viewer-a@tenancy.test');
select tests.create_user('00000000-0000-4000-8000-00000000b001', 'admin-b@tenancy.test');
select tests.create_user('00000000-0000-4000-8000-00000000c001', 'staff@tenancy.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000000c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000000a100', 'Org A'),
  ('00000000-0000-4000-8000-00000000b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000000a200', '00000000-0000-4000-8000-00000000a100', 'Space A', 'tenancy-a'),
  ('00000000-0000-4000-8000-00000000b200', '00000000-0000-4000-8000-00000000b100', 'Space B', 'tenancy-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000000a200'::uuid, '00000000-0000-4000-8000-00000000a001'::uuid, 'admin'),
    ('00000000-0000-4000-8000-00000000a200'::uuid, '00000000-0000-4000-8000-00000000a002'::uuid, 'viewer'),
    ('00000000-0000-4000-8000-00000000b200'::uuid, '00000000-0000-4000-8000-00000000b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.audit_events (space_id, action)
values
  ('00000000-0000-4000-8000-00000000a200', 'test.a'),
  ('00000000-0000-4000-8000-00000000b200', 'test.b');

create table tests.b_admin_role as
select id from public.roles where space_id = '00000000-0000-4000-8000-00000000b200' and key = 'admin';
grant usage on schema tests to authenticated;
grant select on tests.b_admin_role to authenticated;

-- ---------------------------------------------------------------------------
-- Access token hook
-- ---------------------------------------------------------------------------
select is(
  public.custom_access_token_hook(
    '{"user_id": "00000000-0000-4000-8000-00000000a001", "claims": {"sub": "00000000-0000-4000-8000-00000000a001"}}'
  ) -> 'claims' -> 'spaces',
  '[{"id": "00000000-0000-4000-8000-00000000a200", "role": "admin"}]'::jsonb,
  'hook adds the user''s spaces and roles'
);

select is(
  public.custom_access_token_hook(
    '{"user_id": "00000000-0000-4000-8000-00000000a001", "claims": {"sub": "00000000-0000-4000-8000-00000000a001", "aal": "aal1"}}'
  ) -> 'claims' ->> 'aal',
  'aal1',
  'hook keeps the existing claims'
);

select is(
  (public.custom_access_token_hook(
    '{"user_id": "00000000-0000-4000-8000-00000000c001", "claims": {}}'
  ) -> 'claims' ->> 'agency_staff')::boolean,
  true,
  'hook flags agency staff'
);

select is(
  public.custom_access_token_hook(
    '{"user_id": "00000000-0000-4000-8000-00000000c001", "claims": {}}'
  ) -> 'claims' -> 'spaces',
  '[]'::jsonb,
  'hook gives an empty spaces list to a user with no memberships'
);

select ok(
  has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'only supabase_auth_admin can execute the hook'
);

select is(
  (select display_name from public.profiles where user_id = '00000000-0000-4000-8000-00000000a001'),
  'admin-a@tenancy.test',
  'a new auth user gets a profile'
);

-- ---------------------------------------------------------------------------
-- Member of A (admin) cannot read B
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000000a001');

select is(public.auth_space_ids(), '{00000000-0000-4000-8000-00000000a200}'::uuid[], 'auth_space_ids() reads the claims');
select ok(public.has_space_role('00000000-0000-4000-8000-00000000a200', '{admin}'), 'has_space_role() is true for the held role');
select ok(not public.has_space_role('00000000-0000-4000-8000-00000000b200', '{admin}'), 'has_space_role() is false for another space');

select is_empty($$select 1 from public.organisations where id = '00000000-0000-4000-8000-00000000b100'$$, 'A cannot read B''s organisation');
select is_empty($$select 1 from public.spaces where id = '00000000-0000-4000-8000-00000000b200'$$, 'A cannot read space B');
select is_empty($$select 1 from public.environments where space_id = '00000000-0000-4000-8000-00000000b200'$$, 'A cannot read B''s environments');
select is_empty($$select 1 from public.roles where space_id = '00000000-0000-4000-8000-00000000b200'$$, 'A cannot read B''s roles');
select is_empty($$select 1 from public.members where space_id = '00000000-0000-4000-8000-00000000b200'$$, 'A cannot read B''s members');
select is_empty($$select 1 from public.profiles where user_id = '00000000-0000-4000-8000-00000000b001'$$, 'A cannot read B''s member profiles');
select is_empty($$select 1 from public.audit_events where space_id = '00000000-0000-4000-8000-00000000b200'$$, 'A cannot read B''s audit events');

-- ... but can read A (so the checks above are not passing vacuously).
select isnt_empty($$select 1 from public.organisations where id = '00000000-0000-4000-8000-00000000a100'$$, 'A reads its organisation');
select isnt_empty($$select 1 from public.spaces where id = '00000000-0000-4000-8000-00000000a200'$$, 'A reads space A');
select isnt_empty($$select 1 from public.environments where space_id = '00000000-0000-4000-8000-00000000a200'$$, 'A reads its environments');
select isnt_empty($$select 1 from public.roles where space_id = '00000000-0000-4000-8000-00000000a200'$$, 'A reads its roles');
select results_eq(
  $$select count(*)::int from public.members where space_id = '00000000-0000-4000-8000-00000000a200'$$,
  $$values (2)$$,
  'A reads its members'
);
select isnt_empty($$select 1 from public.profiles where user_id = '00000000-0000-4000-8000-00000000a002'$$, 'A reads co-member profiles');
select isnt_empty($$select 1 from public.audit_events where space_id = '00000000-0000-4000-8000-00000000a200'$$, 'A admin reads its audit events');

-- ---------------------------------------------------------------------------
-- Member of A cannot insert into B
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.organisations (name) values ('Rogue org')$$,
  '42501', null, 'A cannot create organisations'
);
select throws_ok(
  $$insert into public.spaces (organisation_id, name, slug) values ('00000000-0000-4000-8000-00000000b100', 'Rogue', 'rogue')$$,
  '42501', null, 'A cannot create spaces'
);
select throws_ok(
  $$insert into public.environments (space_id, name) values ('00000000-0000-4000-8000-00000000b200', 'rogue')$$,
  '42501', null, 'A cannot insert environments into B'
);
select throws_ok(
  $$insert into public.roles (space_id, key, name) values ('00000000-0000-4000-8000-00000000b200', 'rogue', 'Rogue')$$,
  '42501', null, 'A cannot insert roles into B'
);
-- A cannot look B's roles up, so the id comes from the fixture table.
select throws_ok(
  $$insert into public.members (space_id, user_id, role_id)
    select '00000000-0000-4000-8000-00000000b200', '00000000-0000-4000-8000-00000000a001', id from tests.b_admin_role$$,
  '42501', null, 'A cannot add itself to B'
);
select throws_ok(
  $$insert into public.profiles (user_id) values ('00000000-0000-4000-8000-00000000b001')$$,
  '42501', null, 'A cannot insert profiles'
);
select throws_ok(
  $$insert into public.audit_events (space_id, action) values ('00000000-0000-4000-8000-00000000b200', 'rogue')$$,
  '42501', null, 'A cannot insert audit events into B'
);
select throws_ok(
  $$insert into public.audit_events (space_id, action) values ('00000000-0000-4000-8000-00000000a200', 'rogue')$$,
  '42501', null, 'audit events are never inserted by authenticated users, even in their own space'
);

-- ---------------------------------------------------------------------------
-- Member of A cannot update B
-- ---------------------------------------------------------------------------
select is_empty($$update public.organisations set name = 'x' where id = '00000000-0000-4000-8000-00000000b100' returning 1$$, 'A cannot update B''s organisation');
select is_empty($$update public.spaces set name = 'x' where id = '00000000-0000-4000-8000-00000000b200' returning 1$$, 'A cannot update space B');
select is_empty($$update public.environments set name = 'x' where space_id = '00000000-0000-4000-8000-00000000b200' returning 1$$, 'A cannot update B''s environments');
select is_empty($$update public.roles set name = 'x' where space_id = '00000000-0000-4000-8000-00000000b200' returning 1$$, 'A cannot update B''s roles');
select is_empty($$update public.members set invited_by = null where space_id = '00000000-0000-4000-8000-00000000b200' returning 1$$, 'A cannot update B''s members');
select is_empty($$update public.profiles set display_name = 'x' where user_id = '00000000-0000-4000-8000-00000000b001' returning 1$$, 'A cannot update B''s profiles');
select throws_ok(
  $$update public.audit_events set action = 'x' where space_id = '00000000-0000-4000-8000-00000000b200'$$,
  '42501', null, 'A cannot update B''s audit events'
);
-- Moving a row of A into B is a write to B.
select throws_ok(
  $$update public.environments set space_id = '00000000-0000-4000-8000-00000000b200' where space_id = '00000000-0000-4000-8000-00000000a200'$$,
  '42501', null, 'A cannot move its environments into B'
);

-- ---------------------------------------------------------------------------
-- Member of A cannot delete in B
-- ---------------------------------------------------------------------------
select is_empty($$delete from public.organisations where id = '00000000-0000-4000-8000-00000000b100' returning 1$$, 'A cannot delete B''s organisation');
select is_empty($$delete from public.spaces where id = '00000000-0000-4000-8000-00000000b200' returning 1$$, 'A cannot delete space B');
select is_empty($$delete from public.environments where space_id = '00000000-0000-4000-8000-00000000b200' returning 1$$, 'A cannot delete B''s environments');
select is_empty($$delete from public.roles where space_id = '00000000-0000-4000-8000-00000000b200' returning 1$$, 'A cannot delete B''s roles');
select is_empty($$delete from public.members where space_id = '00000000-0000-4000-8000-00000000b200' returning 1$$, 'A cannot delete B''s members');
select throws_ok(
  $$delete from public.profiles where user_id = '00000000-0000-4000-8000-00000000b001'$$,
  '42501', null, 'A cannot delete profiles'
);
select throws_ok(
  $$delete from public.audit_events where space_id = '00000000-0000-4000-8000-00000000b200'$$,
  '42501', null, 'A cannot delete B''s audit events'
);

-- ---------------------------------------------------------------------------
-- Admin of A can manage A
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.environments (space_id, name) values ('00000000-0000-4000-8000-00000000a200', 'staging')$$,
  'A admin can add an environment to A'
);
select isnt_empty(
  $$update public.members set role_id = (select id from public.roles where space_id = '00000000-0000-4000-8000-00000000a200' and key = 'editor')
    where space_id = '00000000-0000-4000-8000-00000000a200' and user_id = '00000000-0000-4000-8000-00000000a002' returning 1$$,
  'A admin can change a member''s role'
);
select isnt_empty($$update public.spaces set name = 'Space A renamed' where id = '00000000-0000-4000-8000-00000000a200' returning 1$$, 'A admin can rename space A');

-- Users edit their own display fields only.
select isnt_empty($$update public.profiles set display_name = 'Admin A' where user_id = '00000000-0000-4000-8000-00000000a001' returning 1$$, 'users can update their own display name');
select is_empty($$update public.profiles set display_name = 'x' where user_id = '00000000-0000-4000-8000-00000000a002' returning 1$$, 'users cannot update a co-member''s profile');
select throws_ok(
  $$update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000000a001'$$,
  '42501', null, 'users cannot make themselves agency staff'
);

-- ---------------------------------------------------------------------------
-- Viewer of A can read A but not write it
-- ---------------------------------------------------------------------------
reset role;
-- viewer_a was promoted to editor above; set them back to viewer for these checks.
update public.members set role_id = (select id from public.roles where space_id = '00000000-0000-4000-8000-00000000a200' and key = 'viewer')
where user_id = '00000000-0000-4000-8000-00000000a002';
select tests.authenticate_as('00000000-0000-4000-8000-00000000a002');

select isnt_empty($$select 1 from public.spaces where id = '00000000-0000-4000-8000-00000000a200'$$, 'viewer reads space A');
select isnt_empty($$select 1 from public.members where space_id = '00000000-0000-4000-8000-00000000a200'$$, 'viewer reads A''s members');
select is_empty($$select 1 from public.audit_events$$, 'viewer cannot read audit events');
select is_empty($$update public.spaces set name = 'x' where id = '00000000-0000-4000-8000-00000000a200' returning 1$$, 'viewer cannot update space A');
select throws_ok(
  $$insert into public.environments (space_id, name) values ('00000000-0000-4000-8000-00000000a200', 'viewer-env')$$,
  '42501', null, 'viewer cannot add environments'
);
select is_empty($$update public.environments set name = 'x' where space_id = '00000000-0000-4000-8000-00000000a200' returning 1$$, 'viewer cannot update environments');
select is_empty($$delete from public.environments where space_id = '00000000-0000-4000-8000-00000000a200' returning 1$$, 'viewer cannot delete environments');
select throws_ok(
  $$insert into public.roles (space_id, key, name) values ('00000000-0000-4000-8000-00000000a200', 'custom', 'Custom')$$,
  '42501', null, 'viewer cannot add roles'
);
select is_empty($$update public.roles set name = 'x' where space_id = '00000000-0000-4000-8000-00000000a200' returning 1$$, 'viewer cannot update roles');
select is_empty($$delete from public.roles where space_id = '00000000-0000-4000-8000-00000000a200' returning 1$$, 'viewer cannot delete roles');
select is_empty(
  $$update public.members set role_id = (select id from public.roles where space_id = '00000000-0000-4000-8000-00000000a200' and key = 'admin')
    where user_id = '00000000-0000-4000-8000-00000000a002' returning 1$$,
  'viewer cannot promote themselves'
);
select is_empty($$delete from public.members where space_id = '00000000-0000-4000-8000-00000000a200' returning 1$$, 'viewer cannot remove members');
select throws_ok(
  $$insert into public.members (space_id, user_id, role_id)
    select '00000000-0000-4000-8000-00000000a200', '00000000-0000-4000-8000-00000000b001', id
    from public.roles where space_id = '00000000-0000-4000-8000-00000000a200' and key = 'viewer'$$,
  '42501', null, 'viewer cannot add members'
);

-- ---------------------------------------------------------------------------
-- Agency staff read everything at AAL2, nothing extra at AAL1
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000000c001', 'aal1');

select ok(not public.is_agency_staff(), 'is_agency_staff() is false without a second factor');
select is_empty($$select 1 from public.spaces where id in ('00000000-0000-4000-8000-00000000a200', '00000000-0000-4000-8000-00000000b200')$$, 'staff at AAL1 cannot read client spaces');
select throws_ok(
  $$insert into public.spaces (organisation_id, name, slug) values ('00000000-0000-4000-8000-00000000a100', 'Staff AAL1', 'staff-aal1')$$,
  '42501', null, 'staff at AAL1 cannot create spaces'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000000c001', 'aal2');

select ok(public.is_agency_staff(), 'is_agency_staff() is true at AAL2');
select results_eq(
  $$select count(*)::int from public.spaces where id in ('00000000-0000-4000-8000-00000000a200', '00000000-0000-4000-8000-00000000b200')$$,
  $$values (2)$$,
  'staff read every space'
);
select isnt_empty($$select 1 from public.organisations where id = '00000000-0000-4000-8000-00000000b100'$$, 'staff read every organisation');
select isnt_empty($$select 1 from public.environments where space_id = '00000000-0000-4000-8000-00000000b200'$$, 'staff read every environment');
select isnt_empty($$select 1 from public.roles where space_id = '00000000-0000-4000-8000-00000000b200'$$, 'staff read every role');
select isnt_empty($$select 1 from public.members where space_id = '00000000-0000-4000-8000-00000000b200'$$, 'staff read every member');
select isnt_empty($$select 1 from public.profiles where user_id = '00000000-0000-4000-8000-00000000b001'$$, 'staff read every profile');
select isnt_empty($$select 1 from public.audit_events where space_id = '00000000-0000-4000-8000-00000000b200'$$, 'staff read every audit event');
select lives_ok(
  $$insert into public.spaces (organisation_id, name, slug) values ('00000000-0000-4000-8000-00000000a100', 'Acme Ltd', 'tenancy-acme')$$,
  'staff create spaces'
);
select lives_ok(
  $$insert into public.members (space_id, user_id, role_id)
    select s.id, '00000000-0000-4000-8000-00000000a002', r.id
    from public.spaces s join public.roles r on r.space_id = s.id and r.key = 'editor'
    where s.slug = 'tenancy-acme'$$,
  'staff add members to a client space'
);
select throws_ok(
  $$insert into public.audit_events (space_id, action) values ('00000000-0000-4000-8000-00000000b200', 'staff')$$,
  '42501', null, 'staff cannot insert audit events directly'
);

-- ---------------------------------------------------------------------------
-- anon and missing claims
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$select 1 from public.spaces$$, '42501', null, 'anon cannot query spaces');
select throws_ok($$select 1 from public.members$$, '42501', null, 'anon cannot query members');

reset role;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated"}', true);
set local role authenticated;
select is_empty($$select 1 from public.spaces$$, 'a token without space claims reads no spaces');
select is(public.auth_space_ids(), '{}'::uuid[], 'auth_space_ids() is empty without the claim');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000a001", "role": "authenticated", "spaces": "not-an-array"}', true);
select is(public.auth_space_ids(), '{}'::uuid[], 'auth_space_ids() ignores a malformed claim');

-- Service role (the API) inserts audit events.
reset role;
set local role service_role;
select lives_ok(
  $$insert into public.audit_events (space_id, action) values ('00000000-0000-4000-8000-00000000a200', 'service.created')$$,
  'service_role inserts audit events'
);

reset role;
select * from finish();
rollback;
