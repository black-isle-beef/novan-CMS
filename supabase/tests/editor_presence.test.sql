-- Visual editor presence (package 12c): RLS on realtime.messages for `editor:<space>:<entry>` topics.
--
-- Fixture: spaces A and B in separate organisations.
--   viewer_a  viewer of A    admin_b  admin of B    staff  agency staff (not a member of either)
-- Members of a space join its pages' presence channels; members of other spaces cannot join, read or write
-- them; only presence goes over them; other topics are untouched by these policies.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

-- Sets the channel Realtime checks the caller against, as Realtime does when someone joins.
create function tests.on_topic(topic text)
returns void
language sql
as $$
  select set_config('realtime.topic', topic, true);
$$;

-- Presence of the caller on the current topic, as Realtime writes it when someone tracks.
create function tests.track(topic text)
returns void
language sql
as $$
  insert into realtime.messages (topic, extension, event, payload, private)
  values (topic, 'presence', 'presence', '{"name": "test"}', true);
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000012a001', 'viewer-a@presence.test');
select tests.create_user('00000000-0000-4000-8000-00000012b001', 'admin-b@presence.test');
select tests.create_user('00000000-0000-4000-8000-00000012c001', 'staff@presence.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000012c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000012a100', 'Org A'),
  ('00000000-0000-4000-8000-00000012b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000012a200', '00000000-0000-4000-8000-00000012a100', 'Space A', 'presence-a'),
  ('00000000-0000-4000-8000-00000012b200', '00000000-0000-4000-8000-00000012b100', 'Space B', 'presence-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000012a200'::uuid, '00000000-0000-4000-8000-00000012a001'::uuid, 'viewer'),
    ('00000000-0000-4000-8000-00000012b200'::uuid, '00000000-0000-4000-8000-00000012b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

-- Topics of a page in A and a page in B.
\set topic_a '\'editor:00000000-0000-4000-8000-00000012a200:00000000-0000-4000-8000-00000012a900\''
\set topic_b '\'editor:00000000-0000-4000-8000-00000012b200:00000000-0000-4000-8000-00000012b900\''

-- ---------------------------------------------------------------------------
-- A member of A (any role) on A's page
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000012a001');
select tests.on_topic(:topic_a);

select lives_ok(format('select tests.track(%L)', :topic_a), 'a member says they are on a page of their space');
select is(
  (select count(*)::int from realtime.messages where topic = :topic_a and extension = 'presence'),
  1,
  'and sees who is there'
);
select throws_ok(
  format($$insert into realtime.messages (topic, extension, event, payload, private) values (%L, 'broadcast', 'x', '{}', true)$$, :topic_a),
  '42501',
  null,
  'nothing but presence goes over the channel'
);

-- On B's page.
select tests.on_topic(:topic_b);
select throws_ok(format('select tests.track(%L)', :topic_b), '42501', null, 'a member of A cannot join a page of B');

-- A topic that is not a visual editor topic is not opened by these policies.
select tests.on_topic('editor:not-a-space');
select throws_ok($$select tests.track('editor:not-a-space')$$, '42501', null, 'a malformed topic is refused');

-- ---------------------------------------------------------------------------
-- A member of B looking at A's page
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000012b001');
select tests.on_topic(:topic_a);
select is(
  (select count(*)::int from realtime.messages where topic = :topic_a),
  0,
  'a member of B cannot see who is on a page of A'
);
select throws_ok(format('select tests.track(%L)', :topic_a), '42501', null, 'nor say they are there');

-- ---------------------------------------------------------------------------
-- Agency staff: with a second factor, as everywhere else
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000012c001', 'aal1');
select tests.on_topic(:topic_a);
select throws_ok(format('select tests.track(%L)', :topic_a), '42501', null, 'staff without a second factor cannot join');

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000012c001', 'aal2');
select tests.on_topic(:topic_a);
select lives_ok(format('select tests.track(%L)', :topic_a), 'staff with a second factor can join');

select * from finish();
rollback;
