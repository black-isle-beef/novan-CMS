-- Onboarding checklist (package 11): `complete_onboarding_step` and `dismiss_onboarding`.
--
-- Fixture: spaces A (with a checklist) and B (with a checklist) in separate organisations, and C (without one).
--   author_a  author of A    viewer_a  viewer of A    admin_b  admin of B    staff  agency staff
-- Authors and up of a space complete steps and dismiss its checklist; viewers and members of other spaces
-- cannot, nor can anyone write `spaces.settings` of a space they only belong to as an author.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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

-- Reads a space's checklist as the table owner, whoever the test is acting as.
create function tests.onboarding(space uuid)
returns jsonb
language sql
security definer
as $$
  select settings -> 'onboarding' from public.spaces where id = space;
$$;

grant usage on schema tests to authenticated;
grant execute on function tests.onboarding(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000011a001', 'author-a@onboarding.test');
select tests.create_user('00000000-0000-4000-8000-00000011a002', 'viewer-a@onboarding.test');
select tests.create_user('00000000-0000-4000-8000-00000011b001', 'admin-b@onboarding.test');
select tests.create_user('00000000-0000-4000-8000-00000011c001', 'staff@onboarding.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000011c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000011a100', 'Org A'),
  ('00000000-0000-4000-8000-00000011b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug, settings)
values
  ('00000000-0000-4000-8000-00000011a200', '00000000-0000-4000-8000-00000011a100', 'Space A', 'onboarding-a',
   '{"onboarding": {"completed": {"logo": "2020-01-01T00:00:00Z"}, "dismissedAt": null}}'),
  ('00000000-0000-4000-8000-00000011b200', '00000000-0000-4000-8000-00000011b100', 'Space B', 'onboarding-b',
   '{"onboarding": {"completed": {}, "dismissedAt": null}}'),
  ('00000000-0000-4000-8000-00000011a300', '00000000-0000-4000-8000-00000011a100', 'Space C', 'onboarding-c', '{}');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000011a200'::uuid, '00000000-0000-4000-8000-00000011a001'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000011a200'::uuid, '00000000-0000-4000-8000-00000011a002'::uuid, 'viewer'),
    ('00000000-0000-4000-8000-00000011a300'::uuid, '00000000-0000-4000-8000-00000011a001'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000011b200'::uuid, '00000000-0000-4000-8000-00000011b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

-- ---------------------------------------------------------------------------
-- An author of A
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000011a001');

select lives_ok(
  $$select public.complete_onboarding_step('00000000-0000-4000-8000-00000011a200', 'newPage')$$,
  'an author completes a step in their space'
);
select ok(
  tests.onboarding('00000000-0000-4000-8000-00000011a200') #> '{completed}' ? 'newPage',
  'the step is recorded with when it was done'
);

select public.complete_onboarding_step('00000000-0000-4000-8000-00000011a200', 'logo');
select is(
  tests.onboarding('00000000-0000-4000-8000-00000011a200') #>> '{completed,logo}', '2020-01-01T00:00:00Z',
  'completing a step again keeps the first time'
);

select throws_ok(
  $$select public.complete_onboarding_step('00000000-0000-4000-8000-00000011a200', 'billing')$$,
  '22023', null, 'only known steps are recorded'
);

select lives_ok(
  $$select public.complete_onboarding_step('00000000-0000-4000-8000-00000011a300', 'publish')$$,
  'a space without a checklist accepts the call'
);
select is(
  tests.onboarding('00000000-0000-4000-8000-00000011a300'), null,
  '... but gains no checklist'
);

-- Cross-tenant: A's author cannot touch B.
select throws_ok(
  $$select public.complete_onboarding_step('00000000-0000-4000-8000-00000011b200', 'publish')$$,
  '42501', null, 'a member of A cannot complete a step of B'
);
select throws_ok(
  $$select public.dismiss_onboarding('00000000-0000-4000-8000-00000011b200')$$,
  '42501', null, 'a member of A cannot dismiss the checklist of B'
);
select is(
  tests.onboarding('00000000-0000-4000-8000-00000011b200'),
  '{"completed": {}, "dismissedAt": null}'::jsonb,
  'B''s checklist is unchanged'
);

-- The functions are the only way in: an author still cannot write the settings directly.
update public.spaces set settings = '{}' where id = '00000000-0000-4000-8000-00000011a200';
select isnt(
  tests.onboarding('00000000-0000-4000-8000-00000011a200'), null,
  'an author cannot overwrite the space settings'
);

-- ---------------------------------------------------------------------------
-- A viewer of A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000011a002');

select throws_ok(
  $$select public.complete_onboarding_step('00000000-0000-4000-8000-00000011a200', 'logo')$$,
  '42501', null, 'a viewer cannot complete a step'
);
select throws_ok(
  $$select public.dismiss_onboarding('00000000-0000-4000-8000-00000011a200')$$,
  '42501', null, 'a viewer cannot dismiss the checklist'
);

-- ---------------------------------------------------------------------------
-- Dismissing
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000011a001');

select lives_ok(
  $$select public.dismiss_onboarding('00000000-0000-4000-8000-00000011a200')$$,
  'an author dismisses the checklist of their space'
);
select isnt(
  tests.onboarding('00000000-0000-4000-8000-00000011a200') ->> 'dismissedAt', null,
  'the checklist records when it was dismissed'
);

-- ---------------------------------------------------------------------------
-- Agency staff, at AAL2 only
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000011c001', 'aal1');
select throws_ok(
  $$select public.complete_onboarding_step('00000000-0000-4000-8000-00000011b200', 'logo')$$,
  '42501', null, 'agency staff without a second factor cannot complete a step'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000011c001', 'aal2');
select lives_ok(
  $$select public.complete_onboarding_step('00000000-0000-4000-8000-00000011b200', 'logo')$$,
  'agency staff complete a step in any space'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok(
  $$select public.dismiss_onboarding('00000000-0000-4000-8000-00000011a200')$$,
  '42501', null, 'anon cannot call the functions'
);

select * from finish();
rollback;
