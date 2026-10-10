-- Webhooks (package 17, 0017): who manages them, that nobody reads a secret back, and deliveries across spaces.
--
-- Fixture: spaces A and B in separate organisations, a webhook in each with one delivery.
--   developer_a  developer of A    editor_a  editor of A    developer_b  developer of B
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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

select tests.create_user('00000000-0000-4000-8000-00000019a001', 'developer-a@webhooks.test');
select tests.create_user('00000000-0000-4000-8000-00000019a002', 'editor-a@webhooks.test');
select tests.create_user('00000000-0000-4000-8000-00000019b001', 'developer-b@webhooks.test');

insert into public.organisations (id, name)
values ('00000000-0000-4000-8000-00000019a100', 'Org A'), ('00000000-0000-4000-8000-00000019b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000019a200', '00000000-0000-4000-8000-00000019a100', 'Space A', 'webhooks-a'),
  ('00000000-0000-4000-8000-00000019b200', '00000000-0000-4000-8000-00000019b100', 'Space B', 'webhooks-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000019a200'::uuid, '00000000-0000-4000-8000-00000019a001'::uuid, 'developer'),
    ('00000000-0000-4000-8000-00000019a200'::uuid, '00000000-0000-4000-8000-00000019a002'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000019b200'::uuid, '00000000-0000-4000-8000-00000019b001'::uuid, 'developer')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.webhooks (id, space_id, name, url, events, secret)
values
  ('00000000-0000-4000-8000-00000019a300', '00000000-0000-4000-8000-00000019a200', 'A hook', 'https://a.example/hook', '{entry.published}', repeat('a', 40)),
  ('00000000-0000-4000-8000-00000019b300', '00000000-0000-4000-8000-00000019b200', 'B hook', 'https://b.example/hook', '{entry.published}', repeat('b', 40));

insert into public.webhook_deliveries (id, webhook_id, space_id, event_id, event, payload, status, attempt, response_code)
values
  ('00000000-0000-4000-8000-00000019a400', '00000000-0000-4000-8000-00000019a300', '00000000-0000-4000-8000-00000019a200',
   gen_random_uuid(), 'entry.published', '{}', 'delivered', 1, 200),
  ('00000000-0000-4000-8000-00000019b400', '00000000-0000-4000-8000-00000019b300', '00000000-0000-4000-8000-00000019b200',
   gen_random_uuid(), 'entry.published', '{}', 'delivered', 1, 200);

-- ---------------------------------------------------------------------------
-- A developer of A
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000019a001');

select results_eq('select name from public.webhooks', $$values ('A hook')$$, 'a developer sees the space''s webhooks');
select throws_ok('select secret from public.webhooks', '42501', null, 'but never a secret');
select lives_ok(
  $$update public.webhooks set secret = repeat('c', 40), active = false where id = '00000000-0000-4000-8000-00000019a300'$$,
  'though they can replace it'
);
select lives_ok(
  $$insert into public.webhooks (space_id, name, url, events, secret, created_by)
    values ('00000000-0000-4000-8000-00000019a200', 'Another', 'https://c.example/hook', '{asset.deleted}', repeat('d', 40),
            '00000000-0000-4000-8000-00000019a001')$$,
  'and make webhooks'
);
select results_eq(
  'select status from public.webhook_deliveries',
  $$values ('delivered')$$,
  'and read their deliveries'
);
select lives_ok(
  $$insert into public.webhook_deliveries (webhook_id, space_id, event_id, event, payload, resend_of)
    values ('00000000-0000-4000-8000-00000019a300', '00000000-0000-4000-8000-00000019a200', gen_random_uuid(), 'entry.published', '{}',
            '00000000-0000-4000-8000-00000019a400')$$,
  'and resend one'
);
select throws_ok(
  $$insert into public.webhook_deliveries (webhook_id, space_id, event_id, event, payload, status, attempt, response_code)
    values ('00000000-0000-4000-8000-00000019a300', '00000000-0000-4000-8000-00000019a200', gen_random_uuid(), 'entry.published', '{}',
            'delivered', 1, 200)$$,
  '42501', null, 'but cannot record a delivery as made'
);
select throws_ok(
  $$update public.webhook_deliveries set status = 'delivered' where id = '00000000-0000-4000-8000-00000019a400'$$,
  '42501', null, 'nor change one'
);
select throws_ok(
  $$insert into public.webhook_deliveries (webhook_id, space_id, event_id, event, payload)
    values ('00000000-0000-4000-8000-00000019b300', '00000000-0000-4000-8000-00000019a200', gen_random_uuid(), 'entry.published', '{}')$$,
  '23503', null, 'a delivery belongs to a webhook of its own space'
);

-- ---------------------------------------------------------------------------
-- An editor of A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000019a002');
select is_empty('select id from public.webhooks', 'an editor does not see webhooks');
select is_empty('select id from public.webhook_deliveries', 'nor deliveries');

-- ---------------------------------------------------------------------------
-- Another space
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000019b001');
select results_eq('select name from public.webhooks', $$values ('B hook')$$, 'a developer of B sees only B''s webhooks');
select is_empty(
  $$update public.webhooks set url = 'https://evil.example/' where id = '00000000-0000-4000-8000-00000019a300' returning id$$,
  'and cannot point A''s elsewhere'
);
select throws_ok(
  $$insert into public.webhooks (space_id, name, url, events, secret)
    values ('00000000-0000-4000-8000-00000019a200', 'Mine', 'https://evil.example/', '{entry.published}', repeat('e', 40))$$,
  '42501', null, 'nor add one to A'
);

select * from finish();
rollback;
