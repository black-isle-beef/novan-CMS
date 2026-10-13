-- Device sign-in for the CLI (package 19, 0022): nobody but the API's own connection reads or writes the codes, and a
-- signed-in person can only approve or deny a pending, unexpired code, as themselves.
--
-- Fixture: users one and two, and four codes: pending, pending with hyphen-free lower-case lookup, expired, and one
-- already approved by user two.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

create schema tests;

create function tests.authenticate_as(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
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

select tests.create_user('00000000-0000-4000-8000-00000022a001', 'one@device.test');
select tests.create_user('00000000-0000-4000-8000-00000022a002', 'two@device.test');

insert into public.device_authorizations (device_code_hash, user_code, client_name, status, user_id, expires_at, decided_at)
values
  (repeat('a', 64), 'BCDFGHJK', 'Novan CLI on test', 'pending', null, now() + interval '10 minutes', null),
  (repeat('b', 64), 'LMNPQRST', 'Novan CLI on test', 'pending', null, now() + interval '10 minutes', null),
  (repeat('c', 64), 'VWXZBCDF', 'Novan CLI on test', 'pending', null, now() - interval '1 minute', null),
  (repeat('d', 64), 'GHJKLMNP', 'Novan CLI on test', 'approved', '00000000-0000-4000-8000-00000022a002', now() + interval '10 minutes', now());

select ok(
  (select relrowsecurity from pg_class where oid = 'public.device_authorizations'::regclass),
  'row-level security is on'
);

-- --- Nobody but the API reads or writes the table ----------------------------------------------------------------

select tests.authenticate_as('00000000-0000-4000-8000-00000022a001');
select throws_ok(
  $$ select count(*) from public.device_authorizations $$,
  '42501', null, 'a signed-in person cannot read device codes'
);
select throws_ok(
  $$ insert into public.device_authorizations (device_code_hash, user_code, client_name, expires_at)
     values (repeat('e', 64), 'ZZZZZZZZ', 'x', now() + interval '1 minute') $$,
  '42501', null, 'a signed-in person cannot create device codes'
);
select throws_ok(
  $$ update public.device_authorizations set status = 'approved' $$,
  '42501', null, 'a signed-in person cannot change device codes directly'
);
reset role;

set local role anon;
select throws_ok(
  $$ select count(*) from public.device_authorizations $$,
  '42501', null, 'anon cannot read device codes'
);
select throws_ok(
  $$ select public.decide_device_authorization('BCDFGHJK', true) $$,
  '42501', null, 'anon cannot approve a code'
);
reset role;

-- --- Approving and denying -------------------------------------------------------------------------------------

select tests.authenticate_as('00000000-0000-4000-8000-00000022a001');
select is(public.decide_device_authorization('bcdf-ghjk', true), 'approved', 'a pending code is approved, typed in any case with its hyphen');
select is(public.decide_device_authorization('BCDFGHJK', true), 'not_found', 'an approved code cannot be decided again');
select is(public.decide_device_authorization('VWXZBCDF', true), 'not_found', 'an expired code cannot be approved');
select is(public.decide_device_authorization('GHJKLMNP', true), 'not_found', 'a code another person approved cannot be taken over');
select is(public.decide_device_authorization('LMNPQRST', false), 'denied', 'a pending code can be denied');
reset role;

select is(
  (select user_id from public.device_authorizations where user_code = 'BCDFGHJK'),
  '00000000-0000-4000-8000-00000022a001'::uuid,
  'the approved code records who approved it'
);
select is(
  (select user_id from public.device_authorizations where user_code = 'LMNPQRST'),
  null,
  'a denied code records nobody'
);

-- With no user in the claims, approving is refused rather than recording nobody.
set local role authenticated;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok(
  $$ select public.decide_device_authorization('LMNPQRST', true) $$,
  '42501', 'Sign in to approve a device.', 'approving needs a signed-in person'
);
reset role;

select * from finish();
rollback;
