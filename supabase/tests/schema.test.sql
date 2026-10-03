-- Baseline guarantees of migrations 0001-0002, before any RLS policies exist (package 03 adds
-- policies and the cross-tenant tests in tenancy.test.sql).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Every table in public has row-level security enabled.
select is(
  (select count(*)::int from pg_class
   where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity),
  0,
  'every public table has RLS enabled'
);

-- New spaces get a main environment and the default roles.
insert into public.spaces (id, organisation_id, name, slug)
values ('00000000-0000-4000-8000-0000000002b0', '00000000-0000-4000-8000-000000000100', 'Space B', 'space-b');

select is(
  (select count(*)::int from public.environments
   where space_id = '00000000-0000-4000-8000-0000000002b0' and name = 'main' and is_main),
  1,
  'a new space gets a main environment'
);

select results_eq(
  $$select key from public.roles where space_id = '00000000-0000-4000-8000-0000000002b0' order by key$$,
  $$values ('admin'), ('author'), ('developer'), ('editor'), ('viewer')$$,
  'a new space gets the default roles'
);

select throws_ok(
  $$insert into public.environments (space_id, name, is_main)
    values ('00000000-0000-4000-8000-0000000002b0', 'second', true)$$,
  '23505', null,
  'a space has only one main environment'
);

-- Members and cloned environments stay inside their space.
select throws_ok(
  $$insert into public.members (space_id, user_id, role_id)
    select '00000000-0000-4000-8000-0000000002b0', '00000000-0000-4000-8000-000000000002', r.id
    from public.roles r where r.space_id = '00000000-0000-4000-8000-000000000200' and r.key = 'admin'$$,
  '23503', null,
  'a member cannot hold a role from another space'
);

select throws_ok(
  $$insert into public.environments (space_id, name, cloned_from_id)
    select '00000000-0000-4000-8000-0000000002b0', 'copy', e.id
    from public.environments e where e.space_id = '00000000-0000-4000-8000-000000000200'$$,
  '23503', null,
  'an environment cannot be cloned from another space'
);

-- Audit events are append-only.
insert into public.audit_events (space_id, action)
values
  ('00000000-0000-4000-8000-000000000200', 'test.created'),
  ('00000000-0000-4000-8000-0000000002b0', 'test.created');

select throws_ok(
  $$update public.audit_events set action = 'changed'$$,
  '42501', null,
  'audit events cannot be updated'
);

select throws_ok(
  $$delete from public.audit_events$$,
  '42501', null,
  'audit events cannot be deleted'
);

select ok(
  not has_table_privilege('service_role', 'public.audit_events', 'update, delete, truncate'),
  'service_role has no update, delete or truncate on audit_events'
);

select lives_ok(
  $$delete from public.spaces where id = '00000000-0000-4000-8000-0000000002b0'$$,
  'deleting a space still cascades'
);

-- Without policies, a signed-in member of the demo space sees nothing.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}',
  true
);

select is_empty('select 1 from public.organisations', 'authenticated cannot read organisations');
select is_empty('select 1 from public.spaces', 'authenticated cannot read spaces');
select is_empty('select 1 from public.environments', 'authenticated cannot read environments');
select is_empty('select 1 from public.roles', 'authenticated cannot read roles');
select is_empty('select 1 from public.members', 'authenticated cannot read members');
select is_empty('select 1 from public.profiles', 'authenticated cannot read profiles');
select is_empty('select 1 from public.audit_events', 'authenticated cannot read audit events');

reset role;

select * from finish();
rollback;
