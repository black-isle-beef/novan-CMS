-- API tokens (package 08): constraints, the guard trigger and row-level security.
--
-- Fixture: spaces A and B in separate organisations, each with one delivery token.
--   dev_a     developer of A    editor_a  editor of A    admin_b  admin of B
--   staff     agency staff, member of nothing (privileged only at AAL2)
-- A member of A can neither read nor write B's tokens. In A, only admins and developers see tokens,
-- create them (as themselves) and rename or revoke them; nobody deletes them, and a revoked token stays
-- revoked.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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

create function tests.main_environment(space uuid)
returns uuid
language sql
as $$
  select id from public.environments where space_id = space and is_main;
$$;

-- Members call it in their inserts below; environments are readable to members only, so it runs as the owner.
alter function tests.main_environment(uuid) security definer;
grant usage on schema tests to authenticated;
grant execute on function tests.main_environment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000008a001', 'dev-a@tokens.test');
select tests.create_user('00000000-0000-4000-8000-00000008a002', 'editor-a@tokens.test');
select tests.create_user('00000000-0000-4000-8000-00000008b001', 'admin-b@tokens.test');
select tests.create_user('00000000-0000-4000-8000-00000008c001', 'staff@tokens.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000008c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000008a100', 'Org A'),
  ('00000000-0000-4000-8000-00000008b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000008a200', '00000000-0000-4000-8000-00000008a100', 'Space A', 'tokens-a'),
  ('00000000-0000-4000-8000-00000008b200', '00000000-0000-4000-8000-00000008b100', 'Space B', 'tokens-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000008a200'::uuid, '00000000-0000-4000-8000-00000008a001'::uuid, 'developer'),
    ('00000000-0000-4000-8000-00000008a200'::uuid, '00000000-0000-4000-8000-00000008a002'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000008b200'::uuid, '00000000-0000-4000-8000-00000008b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.api_tokens (id, space_id, environment_id, name, scope, token_hash, token_hint, created_by)
values
  ('00000000-0000-4000-8000-00000008a300', '00000000-0000-4000-8000-00000008a200',
   tests.main_environment('00000000-0000-4000-8000-00000008a200'), 'Website', 'delivery',
   repeat('a', 64), 'nv_del_…aaaa', '00000000-0000-4000-8000-00000008a001'),
  ('00000000-0000-4000-8000-00000008a301', '00000000-0000-4000-8000-00000008a200',
   tests.main_environment('00000000-0000-4000-8000-00000008a200'), 'Old site', 'preview',
   repeat('c', 64), 'nv_pre_…cccc', '00000000-0000-4000-8000-00000008a001'),
  ('00000000-0000-4000-8000-00000008b300', '00000000-0000-4000-8000-00000008b200',
   tests.main_environment('00000000-0000-4000-8000-00000008b200'), 'Website', 'delivery',
   repeat('b', 64), 'nv_del_…bbbb', '00000000-0000-4000-8000-00000008b001');

-- ---------------------------------------------------------------------------
-- Constraints and the guard (as the table owner, like the API's service role)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint)
    values ('00000000-0000-4000-8000-00000008a200', tests.main_environment('00000000-0000-4000-8000-00000008a200'),
      'Bad', 'delivery', 'nv_del_plaintext', 'nv_del_…text')$$,
  '23514', null, 'only a SHA-256 hash is stored, never the token'
);
select throws_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint)
    values ('00000000-0000-4000-8000-00000008a200', tests.main_environment('00000000-0000-4000-8000-00000008a200'),
      'Mixed', 'delivery', repeat('d', 64), 'nv_pre_…dddd')$$,
  '23514', null, 'the hint''s prefix matches the scope'
);
select throws_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint)
    values ('00000000-0000-4000-8000-00000008a200', tests.main_environment('00000000-0000-4000-8000-00000008a200'),
      'Admin', 'management', repeat('d', 64), 'nv_del_…dddd')$$,
  '23514', null, 'a token is for delivery or preview only'
);
select throws_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint)
    values ('00000000-0000-4000-8000-00000008a200', tests.main_environment('00000000-0000-4000-8000-00000008b200'),
      'Cross', 'delivery', repeat('d', 64), 'nv_del_…dddd')$$,
  '23503', null, 'a token''s environment belongs to its own space'
);
select throws_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint)
    values ('00000000-0000-4000-8000-00000008b200', tests.main_environment('00000000-0000-4000-8000-00000008b200'),
      'Copy', 'delivery', repeat('a', 64), 'nv_del_…aaaa')$$,
  '23505', null, 'two tokens never share a hash'
);
select lives_ok(
  $$update public.api_tokens set last_used_at = now() where id = '00000000-0000-4000-8000-00000008a300'$$,
  'the service role records when a token was used'
);
select throws_ok(
  $$update public.api_tokens set token_hash = repeat('e', 64) where id = '00000000-0000-4000-8000-00000008a300'$$,
  '23514', null, 'a token''s secret never changes'
);
select throws_ok(
  $$update public.api_tokens set space_id = '00000000-0000-4000-8000-00000008b200' where id = '00000000-0000-4000-8000-00000008a300'$$,
  '23514', null, 'a token cannot move to another space'
);

-- ---------------------------------------------------------------------------
-- Developer of A: A's tokens only
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000008a001');

select is_empty($$select 1 from public.api_tokens where space_id = '00000000-0000-4000-8000-00000008b200'$$, 'A cannot read B''s tokens');
select isnt_empty($$select 1 from public.api_tokens where space_id = '00000000-0000-4000-8000-00000008a200'$$, 'a developer of A reads A''s tokens');
select throws_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint, created_by)
    values ('00000000-0000-4000-8000-00000008b200', tests.main_environment('00000000-0000-4000-8000-00000008b200'),
      'Rogue', 'delivery', repeat('f', 64), 'nv_del_…ffff', '00000000-0000-4000-8000-00000008a001')$$,
  '42501', null, 'A cannot create tokens for B'
);
select is_empty(
  $$update public.api_tokens set revoked_at = now() where space_id = '00000000-0000-4000-8000-00000008b200' returning 1$$,
  'A cannot revoke B''s tokens'
);
select lives_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint, created_by)
    values ('00000000-0000-4000-8000-00000008a200', tests.main_environment('00000000-0000-4000-8000-00000008a200'),
      'Preview', 'preview', repeat('1', 64), 'nv_pre_…1111', '00000000-0000-4000-8000-00000008a001')$$,
  'a developer of A creates a token for A'
);
select throws_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint, created_by)
    values ('00000000-0000-4000-8000-00000008a200', tests.main_environment('00000000-0000-4000-8000-00000008a200'),
      'Theirs', 'delivery', repeat('2', 64), 'nv_del_…2222', '00000000-0000-4000-8000-00000008a002')$$,
  '42501', null, 'tokens are created as oneself'
);
select throws_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint, created_by, last_used_at)
    values ('00000000-0000-4000-8000-00000008a200', tests.main_environment('00000000-0000-4000-8000-00000008a200'),
      'Used', 'delivery', repeat('3', 64), 'nv_del_…3333', '00000000-0000-4000-8000-00000008a001', now())$$,
  '42501', null, 'a new token has not been used'
);
select results_eq(
  $$update public.api_tokens set name = 'Main website' where id = '00000000-0000-4000-8000-00000008a300' returning name$$,
  $$values ('Main website')$$,
  'a developer renames a token'
);
select throws_ok(
  $$update public.api_tokens set last_used_at = now() + interval '1 minute' where id = '00000000-0000-4000-8000-00000008a300'$$,
  '23514', null, 'members cannot fake when a token was used'
);
select throws_ok(
  $$update public.api_tokens set scope = 'preview', token_hint = 'nv_pre_…aaaa' where id = '00000000-0000-4000-8000-00000008a300'$$,
  '23514', null, 'a delivery token cannot become a preview token'
);
select results_eq(
  $$update public.api_tokens set revoked_at = now() where id = '00000000-0000-4000-8000-00000008a301' returning id$$,
  $$values ('00000000-0000-4000-8000-00000008a301'::uuid)$$,
  'a developer revokes a token'
);
select throws_ok(
  $$update public.api_tokens set revoked_at = null where id = '00000000-0000-4000-8000-00000008a301'$$,
  '23514', null, 'a revoked token stays revoked'
);
select throws_ok(
  $$delete from public.api_tokens where id = '00000000-0000-4000-8000-00000008a300'$$,
  '42501', null, 'nobody deletes tokens'
);

-- ---------------------------------------------------------------------------
-- Editor of A: tokens are not theirs to see
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000008a002');

select is_empty($$select 1 from public.api_tokens$$, 'an editor sees no tokens');
select throws_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint, created_by)
    values ('00000000-0000-4000-8000-00000008a200', tests.main_environment('00000000-0000-4000-8000-00000008a200'),
      'Mine', 'delivery', repeat('4', 64), 'nv_del_…4444', '00000000-0000-4000-8000-00000008a002')$$,
  '42501', null, 'an editor cannot create tokens'
);
select is_empty(
  $$update public.api_tokens set revoked_at = now() where space_id = '00000000-0000-4000-8000-00000008a200' returning 1$$,
  'an editor cannot revoke tokens'
);

-- ---------------------------------------------------------------------------
-- Admin of B: B's tokens only
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000008b001');

select results_eq(
  $$select id from public.api_tokens$$,
  $$values ('00000000-0000-4000-8000-00000008b300'::uuid)$$,
  'an admin of B reads B''s token and nothing of A'
);
select is_empty(
  $$update public.api_tokens set name = 'Taken' where space_id = '00000000-0000-4000-8000-00000008a200' returning 1$$,
  'B cannot rename A''s tokens'
);

-- ---------------------------------------------------------------------------
-- Agency staff: nothing without a second factor, everything with one
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000008c001');
select is_empty($$select 1 from public.api_tokens$$, 'staff at AAL1 read no tokens');

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000008c001', 'aal2');
select isnt_empty($$select 1 from public.api_tokens where space_id = '00000000-0000-4000-8000-00000008b200'$$, 'staff at AAL2 read any space''s tokens');
select lives_ok(
  $$insert into public.api_tokens (space_id, environment_id, name, scope, token_hash, token_hint, created_by)
    values ('00000000-0000-4000-8000-00000008b200', tests.main_environment('00000000-0000-4000-8000-00000008b200'),
      'Agency', 'delivery', repeat('5', 64), 'nv_del_…5555', '00000000-0000-4000-8000-00000008c001')$$,
  'staff at AAL2 create tokens for any space'
);

-- ---------------------------------------------------------------------------
-- Anonymous visitors see nothing
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select 1 from public.api_tokens$$, '42501', null, 'anon cannot read tokens');

select * from finish();
rollback;
