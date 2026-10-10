-- Background jobs and scheduled publishing (package 17): the queues (0014), scheduled_actions and the cron job that
-- sends due actions to the worker (0015).
--
-- Fixture: space A (approval on) and space B in separate organisations, a draft page in each.
--   editor_a  editor of A    admin_a  admin of A    author_a  author of A    editor_b  editor of B
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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

-- Schedules `action` on A's page, as the signed-in person, an hour from now.
create function tests.schedule_a(action text, by_user uuid)
returns void
language sql
as $$
  insert into public.scheduled_actions (space_id, entry_id, action, run_at, created_by)
  values ('00000000-0000-4000-8000-00000017a200', '00000000-0000-4000-8000-00000017a300', action, now() + interval '1 hour', by_user);
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000017a001', 'editor-a@jobs.test');
select tests.create_user('00000000-0000-4000-8000-00000017a002', 'admin-a@jobs.test');
select tests.create_user('00000000-0000-4000-8000-00000017a003', 'author-a@jobs.test');
select tests.create_user('00000000-0000-4000-8000-00000017b001', 'editor-b@jobs.test');

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000017a100', 'Org A'),
  ('00000000-0000-4000-8000-00000017b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug, require_approval)
values
  ('00000000-0000-4000-8000-00000017a200', '00000000-0000-4000-8000-00000017a100', 'Space A', 'jobs-a', true),
  ('00000000-0000-4000-8000-00000017b200', '00000000-0000-4000-8000-00000017b100', 'Space B', 'jobs-b', false);

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000017a200'::uuid, '00000000-0000-4000-8000-00000017a001'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000017a200'::uuid, '00000000-0000-4000-8000-00000017a002'::uuid, 'admin'),
    ('00000000-0000-4000-8000-00000017a200'::uuid, '00000000-0000-4000-8000-00000017a003'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000017b200'::uuid, '00000000-0000-4000-8000-00000017b001'::uuid, 'editor')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.content_types (space_id, environment_id, api_id, name, kind)
select space_id, id, 'page', 'Page', 'page' from public.environments
where space_id in ('00000000-0000-4000-8000-00000017a200', '00000000-0000-4000-8000-00000017b200') and is_main;

insert into public.entries (id, space_id, environment_id, content_type_id, slug)
select
  case when e.space_id = '00000000-0000-4000-8000-00000017a200'
    then '00000000-0000-4000-8000-00000017a300'::uuid else '00000000-0000-4000-8000-00000017b300'::uuid end,
  e.space_id, e.id, ct.id, 'launch'
from public.environments e
join public.content_types ct on ct.environment_id = e.id
where e.space_id in ('00000000-0000-4000-8000-00000017a200', '00000000-0000-4000-8000-00000017b200') and e.is_main;

-- B's page has an action waiting.
insert into public.scheduled_actions (id, space_id, entry_id, action, run_at, created_by)
values ('00000000-0000-4000-8000-00000017b400', '00000000-0000-4000-8000-00000017b200', '00000000-0000-4000-8000-00000017b300',
        'publish', now() + interval '1 hour', '00000000-0000-4000-8000-00000017b001');

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------
-- The queues
-- ---------------------------------------------------------------------------
select results_eq(
  $$select queue_name::text from pgmq.list_queues() where queue_name in ('publish', 'purge', 'webhooks', 'housekeeping') order by 1$$,
  $$values ('housekeeping'), ('publish'), ('purge'), ('webhooks')$$,
  'the four queues exist'
);
select ok(
  (select count(*) = 1 from cron.job where jobname = 'enqueue-scheduled-actions' and schedule = '* * * * *' and active),
  'a cron job sends due actions every minute'
);

-- ---------------------------------------------------------------------------
-- An editor of A, with approval on
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000017a001');

select throws_ok($$select pgmq.send('purge', '{"type": "forged"}'::jsonb)$$, '42501', null, 'members cannot send jobs');
select throws_ok($$select * from pgmq.q_purge$$, '42501', null, 'nor read them');
select throws_ok($$select * from pgmq.read('purge', 30, 10)$$, '42501', null, 'nor take them');
select throws_ok($$select * from public.job_dead_letters$$, '42501', null, 'nor read the dead letters');
select throws_ok($$select public.enqueue_due_scheduled_actions()$$, '42501', null, 'nor run the cron job''s function');

select throws_ok(
  $$select tests.schedule_a('publish', '00000000-0000-4000-8000-00000017a001')$$,
  '42501', null, 'with approval on, an editor cannot schedule publishing'
);
select lives_ok(
  $$select tests.schedule_a('unpublish', '00000000-0000-4000-8000-00000017a001')$$,
  'but schedules unpublishing'
);
select throws_ok(
  $$select tests.schedule_a('unpublish', '00000000-0000-4000-8000-00000017a001')$$,
  '23505', null, 'one waiting unpublish per page'
);
select throws_ok(
  $$select tests.schedule_a('unpublish', '00000000-0000-4000-8000-00000017a002')$$,
  '42501', null, 'an action is scheduled as oneself'
);
select throws_ok(
  $$insert into public.scheduled_actions (space_id, entry_id, action, run_at, created_by)
    values ('00000000-0000-4000-8000-00000017a200', '00000000-0000-4000-8000-00000017a300', 'publish', now() - interval '1 minute',
            '00000000-0000-4000-8000-00000017a001')$$,
  '23514', null, 'for the future'
);
select throws_ok(
  $$update public.scheduled_actions set run_at = now() + interval '2 hours' where space_id = '00000000-0000-4000-8000-00000017a200'$$,
  '23514', null, 'its time cannot change'
);
select throws_ok(
  $$update public.scheduled_actions set status = 'done', finished_at = now() where space_id = '00000000-0000-4000-8000-00000017a200'$$,
  '23514', null, 'nor can it be marked done'
);
select lives_ok(
  $$update public.scheduled_actions set status = 'cancelled', finished_at = now() where space_id = '00000000-0000-4000-8000-00000017a200'$$,
  'it can be cancelled'
);

-- ---------------------------------------------------------------------------
-- Other people of A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000017a002');
select lives_ok(
  $$select tests.schedule_a('publish', '00000000-0000-4000-8000-00000017a002')$$,
  'a space admin schedules publishing'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000017a003');
select is(
  (select count(*)::int from public.scheduled_actions where space_id = '00000000-0000-4000-8000-00000017a200'),
  2,
  'an author sees what is scheduled'
);
select throws_ok(
  $$select tests.schedule_a('unpublish', '00000000-0000-4000-8000-00000017a003')$$,
  '42501', null, 'but cannot schedule'
);
select is_empty(
  $$update public.scheduled_actions set status = 'cancelled', finished_at = now()
    where space_id = '00000000-0000-4000-8000-00000017a200' and status = 'scheduled' returning id$$,
  'nor cancel'
);

-- ---------------------------------------------------------------------------
-- Another space
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000017b001');
select is(
  (select count(*)::int from public.scheduled_actions where space_id = '00000000-0000-4000-8000-00000017a200'),
  0,
  'an editor of B cannot see A''s scheduled actions'
);
select throws_ok(
  $$select tests.schedule_a('unpublish', '00000000-0000-4000-8000-00000017b001')$$,
  '42501', null, 'nor schedule anything for A'
);
select is_empty(
  $$update public.scheduled_actions set status = 'cancelled', finished_at = now()
    where space_id = '00000000-0000-4000-8000-00000017a200' returning id$$,
  'nor cancel A''s'
);
select throws_ok(
  $$insert into public.scheduled_actions (space_id, entry_id, action, run_at, created_by)
    values ('00000000-0000-4000-8000-00000017b200', '00000000-0000-4000-8000-00000017a300', 'unpublish', now() + interval '1 hour',
            '00000000-0000-4000-8000-00000017b001')$$,
  '23503', null, 'nor point B''s action at A''s page'
);

-- ---------------------------------------------------------------------------
-- The cron job's function: due actions are queued once and sent to the worker
-- ---------------------------------------------------------------------------
reset role;
update public.scheduled_actions set run_at = now() - interval '1 second'
where space_id = '00000000-0000-4000-8000-00000017a200' and status = 'scheduled';

select is(public.enqueue_due_scheduled_actions(), 1, 'the due action is sent, and nothing that is not due');
select ok(
  (select status = 'queued' from public.scheduled_actions
   where space_id = '00000000-0000-4000-8000-00000017a200' and action = 'publish')
  and exists (
    select 1 from pgmq.q_publish
    where message @> jsonb_build_object('type', 'scheduled-action', 'spaceId', '00000000-0000-4000-8000-00000017a200')
  ),
  'it is marked queued, with a job for the worker'
);

select * from finish();
rollback;
