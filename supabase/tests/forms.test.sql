-- Forms (package 18, 0020): who reads and deletes what visitors sent, who changes form settings, retention, and that
-- one space never sees another's submissions.
--
-- Fixture: spaces A and B in separate organisations, a submission in each, and a submission in A older than A's
-- retention (3 months).
--   admin_a  admin of A    editor_a  editor of A    author_a  author of A    developer_a  developer of A
--   admin_b  admin of B
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create schema tests;

create function tests.authenticate_as(user_id uuid)
returns void
language plpgsql
as $$
declare
  claims jsonb;
begin
  claims := public.custom_access_token_hook(jsonb_build_object(
    'user_id', user_id,
    'claims', jsonb_build_object('sub', user_id, 'role', 'authenticated', 'aal', 'aal1')
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

select tests.create_user('00000000-0000-4000-8000-00000021a001', 'admin-a@forms.test');
select tests.create_user('00000000-0000-4000-8000-00000021a002', 'editor-a@forms.test');
select tests.create_user('00000000-0000-4000-8000-00000021a003', 'author-a@forms.test');
select tests.create_user('00000000-0000-4000-8000-00000021a004', 'developer-a@forms.test');
select tests.create_user('00000000-0000-4000-8000-00000021b001', 'admin-b@forms.test');

insert into public.organisations (id, name)
values ('00000000-0000-4000-8000-00000021a100', 'Org A'), ('00000000-0000-4000-8000-00000021b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000021a200', '00000000-0000-4000-8000-00000021a100', 'Space A', 'forms-a'),
  ('00000000-0000-4000-8000-00000021b200', '00000000-0000-4000-8000-00000021b100', 'Space B', 'forms-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000021a200'::uuid, '00000000-0000-4000-8000-00000021a001'::uuid, 'admin'),
    ('00000000-0000-4000-8000-00000021a200'::uuid, '00000000-0000-4000-8000-00000021a002'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000021a200'::uuid, '00000000-0000-4000-8000-00000021a003'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000021a200'::uuid, '00000000-0000-4000-8000-00000021a004'::uuid, 'developer'),
    ('00000000-0000-4000-8000-00000021b200'::uuid, '00000000-0000-4000-8000-00000021b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.form_settings (space_id, recipients, retention_months)
values
  ('00000000-0000-4000-8000-00000021a200', '{office@a.example}', 3),
  ('00000000-0000-4000-8000-00000021b200', '{office@b.example}', 12);

insert into public.form_submissions (id, space_id, form_uid, data, created_at)
values
  ('00000000-0000-4000-8000-00000021a300', '00000000-0000-4000-8000-00000021a200', 'contact', '{"email": "visitor@a.example"}', now()),
  ('00000000-0000-4000-8000-00000021a301', '00000000-0000-4000-8000-00000021a200', 'contact', '{"email": "old@a.example"}',
   now() - interval '4 months'),
  ('00000000-0000-4000-8000-00000021b300', '00000000-0000-4000-8000-00000021b200', 'contact', '{"email": "visitor@b.example"}',
   now() - interval '4 months');

-- ---------------------------------------------------------------------------
-- An editor of A
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000021a002');

select results_eq(
  'select id from public.form_submissions order by created_at desc',
  $$values ('00000000-0000-4000-8000-00000021a300'::uuid), ('00000000-0000-4000-8000-00000021a301'::uuid)$$,
  'an editor reads the space''s submissions'
);
select results_eq('select retention_months from public.form_settings', $$values (3)$$, 'and its form settings');
select throws_ok(
  $$insert into public.form_submissions (space_id, form_uid, data) values ('00000000-0000-4000-8000-00000021a200', 'contact', '{}')$$,
  '42501', null, 'but cannot add a submission'
);
select throws_ok(
  $$update public.form_submissions set data = '{}' where id = '00000000-0000-4000-8000-00000021a300'$$,
  '42501', null, 'or change one'
);
select is_empty(
  $$update public.form_settings set retention_months = 120 returning space_id$$,
  'or change the settings'
);
select results_eq(
  $$delete from public.form_submissions where id = '00000000-0000-4000-8000-00000021a301' returning id$$,
  $$values ('00000000-0000-4000-8000-00000021a301'::uuid)$$,
  'but can delete one'
);

-- ---------------------------------------------------------------------------
-- Authors and developers of A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000021a003');
select is_empty('select id from public.form_submissions', 'an author does not see submissions');
select is_empty('select space_id from public.form_settings', 'or form settings');
select is_empty(
  $$delete from public.form_submissions returning id$$,
  'and cannot delete submissions'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000021a004');
select is_empty('select id from public.form_submissions', 'a developer does not see submissions either');

-- ---------------------------------------------------------------------------
-- An admin of A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000021a001');
select results_eq(
  $$update public.form_settings set recipients = '{office@a.example,sales@a.example}', retention_months = 6
    returning retention_months$$,
  $$values (6)$$,
  'an admin changes the space''s form settings'
);
select throws_ok(
  $$insert into public.form_settings (space_id) values ('00000000-0000-4000-8000-00000021b200')$$,
  '42501', null, 'but not another space''s'
);
select throws_ok(
  $$update public.form_settings set retention_months = 0$$,
  '23514', null, 'retention is between 1 and 120 months'
);
select throws_ok(
  $$select public.purge_expired_form_submissions()$$,
  '42501', null, 'only the API''s own connection purges submissions'
);

-- ---------------------------------------------------------------------------
-- Another space
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000021b001');
select results_eq(
  'select id from public.form_submissions',
  $$values ('00000000-0000-4000-8000-00000021b300'::uuid)$$,
  'an admin of B reads only B''s submissions'
);
select is_empty(
  $$delete from public.form_submissions where id = '00000000-0000-4000-8000-00000021a300' returning id$$,
  'and cannot delete A''s'
);
select is_empty(
  $$update public.form_settings set recipients = '{attacker@b.example}' where space_id = '00000000-0000-4000-8000-00000021a200'
    returning space_id$$,
  'or redirect A''s emails'
);
select throws_ok(
  $$insert into public.form_settings (space_id, recipients) values ('00000000-0000-4000-8000-00000021a200', '{attacker@b.example}')$$,
  '42501', null, 'or add settings to A'
);

-- ---------------------------------------------------------------------------
-- Retention (as the API's worker)
-- ---------------------------------------------------------------------------
reset role;
insert into public.form_submissions (id, space_id, form_uid, data, created_at)
values ('00000000-0000-4000-8000-00000021a302', '00000000-0000-4000-8000-00000021a200', 'contact', '{}', now() - interval '7 months');

select is(public.purge_expired_form_submissions(), 1, 'housekeeping deletes submissions older than their space''s retention');
select results_eq(
  'select id from public.form_submissions where space_id in (''00000000-0000-4000-8000-00000021a200'', ''00000000-0000-4000-8000-00000021b200'') order by id',
  $$values ('00000000-0000-4000-8000-00000021a300'::uuid), ('00000000-0000-4000-8000-00000021b300'::uuid)$$,
  'and keeps newer ones, and B''s within its 12 months'
);

select * from finish();
rollback;
