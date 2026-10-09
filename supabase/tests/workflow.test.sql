-- Workflow and publishing (package 13): spaces.require_approval, review_requests, and the entries guard.
--
-- Fixture: space A (approval on) and space B in separate organisations, a draft page in each.
--   author_a  author of A    editor_a  editor of A    admin_a  admin of A    admin_b  admin of B
--   staff  agency staff, member of neither
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000013a001', 'author-a@workflow.test');
select tests.create_user('00000000-0000-4000-8000-00000013a002', 'editor-a@workflow.test');
select tests.create_user('00000000-0000-4000-8000-00000013a003', 'admin-a@workflow.test');
select tests.create_user('00000000-0000-4000-8000-00000013b001', 'admin-b@workflow.test');
select tests.create_user('00000000-0000-4000-8000-00000013c001', 'staff@workflow.test');
update public.profiles set is_agency_staff = true where user_id = '00000000-0000-4000-8000-00000013c001';

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000013a100', 'Org A'),
  ('00000000-0000-4000-8000-00000013b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug, require_approval)
values
  ('00000000-0000-4000-8000-00000013a200', '00000000-0000-4000-8000-00000013a100', 'Space A', 'workflow-a', true),
  ('00000000-0000-4000-8000-00000013b200', '00000000-0000-4000-8000-00000013b100', 'Space B', 'workflow-b', false);

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000013a200'::uuid, '00000000-0000-4000-8000-00000013a001'::uuid, 'author'),
    ('00000000-0000-4000-8000-00000013a200'::uuid, '00000000-0000-4000-8000-00000013a002'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000013a200'::uuid, '00000000-0000-4000-8000-00000013a003'::uuid, 'admin'),
    ('00000000-0000-4000-8000-00000013b200'::uuid, '00000000-0000-4000-8000-00000013b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

insert into public.content_types (space_id, environment_id, api_id, name, kind)
select space_id, id, 'page', 'Page', 'page' from public.environments
where space_id in ('00000000-0000-4000-8000-00000013a200', '00000000-0000-4000-8000-00000013b200') and is_main;

insert into public.entries (id, space_id, environment_id, content_type_id, slug)
select
  case when e.space_id = '00000000-0000-4000-8000-00000013a200'
    then '00000000-0000-4000-8000-00000013a300'::uuid else '00000000-0000-4000-8000-00000013b300'::uuid end,
  e.space_id, e.id, ct.id, 'home'
from public.environments e
join public.content_types ct on ct.environment_id = e.id
where e.space_id in ('00000000-0000-4000-8000-00000013a200', '00000000-0000-4000-8000-00000013b200') and e.is_main;

insert into public.entry_versions (id, entry_id, space_id, data)
values
  ('00000000-0000-4000-8000-00000013a400', '00000000-0000-4000-8000-00000013a300', '00000000-0000-4000-8000-00000013a200', '{"title": "Home"}'),
  ('00000000-0000-4000-8000-00000013b400', '00000000-0000-4000-8000-00000013b300', '00000000-0000-4000-8000-00000013b200', '{"title": "Home"}');
update public.entries set current_version_id = '00000000-0000-4000-8000-00000013a400' where id = '00000000-0000-4000-8000-00000013a300';
update public.entries set current_version_id = '00000000-0000-4000-8000-00000013b400' where id = '00000000-0000-4000-8000-00000013b300';

-- A's page goes live, the way publishing writes it.
create function tests.publish_a()
returns void
language sql
as $$
  update public.entries
  set status = 'published', published_version_id = '00000000-0000-4000-8000-00000013a400', published_at = now()
  where id = '00000000-0000-4000-8000-00000013a300';
$$;

create function tests.ask_review(by_user uuid)
returns void
language sql
as $$
  insert into public.review_requests (space_id, entry_id, version_id, requested_by)
  values ('00000000-0000-4000-8000-00000013a200', '00000000-0000-4000-8000-00000013a300',
          '00000000-0000-4000-8000-00000013a400', by_user);
$$;

create function tests.decide(decision text, by_user uuid, comment text default null)
returns void
language sql
as $$
  update public.review_requests set decision = $1, decided_by = $2, decided_at = now(), comment = $3
  where entry_id = '00000000-0000-4000-8000-00000013a300' and decision is null;
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------
-- An author of A
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000013a001');

select lives_ok(
  $$select tests.ask_review('00000000-0000-4000-8000-00000013a001')$$,
  'an author asks for a review'
);
select throws_ok(
  $$select tests.ask_review('00000000-0000-4000-8000-00000013a001')$$,
  '23505', null, 'one open request per page'
);
select lives_ok(
  $$update public.entries set status = 'in_review' where id = '00000000-0000-4000-8000-00000013a300'$$,
  'an author sends the page for review'
);
select throws_ok($$select tests.publish_a()$$, '42501', null, 'an author cannot publish');
select throws_ok(
  $$select tests.decide('approved', '00000000-0000-4000-8000-00000013a001')$$,
  '42501', null, 'an author cannot approve'
);
select throws_ok(
  $$update public.entries set status = 'archived' where id = '00000000-0000-4000-8000-00000013a300'$$,
  '42501', null, 'an author cannot archive'
);

-- ---------------------------------------------------------------------------
-- An editor of A, with approval on
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000013a002');
select throws_ok($$select tests.publish_a()$$, '42501', null, 'with approval on, an editor cannot publish');
select throws_ok(
  $$select tests.decide('approved', '00000000-0000-4000-8000-00000013a002')$$,
  '42501', null, 'an editor cannot approve'
);
select throws_ok(
  $$select tests.decide('changes_requested', '00000000-0000-4000-8000-00000013a002', 'Shorter, please')$$,
  '42501', null, 'nor ask for changes'
);
select throws_ok(
  $$update public.review_requests set message = 'changed' where entry_id = '00000000-0000-4000-8000-00000013a300'$$,
  '23514', null, 'a request cannot be rewritten'
);

-- ---------------------------------------------------------------------------
-- An admin of A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000013a003');
select throws_ok(
  $$select tests.decide('changes_requested', '00000000-0000-4000-8000-00000013a003', ' ')$$,
  '23514', null, 'asking for changes needs a comment'
);
select throws_ok(
  $$select tests.decide('approved', '00000000-0000-4000-8000-00000013a002')$$,
  '42501', null, 'a decision is recorded as the person deciding'
);
select lives_ok($$select tests.decide('approved', '00000000-0000-4000-8000-00000013a003')$$, 'an admin approves');
select lives_ok($$select tests.publish_a()$$, 'and publishes');
-- The open request is gone, so this changes nothing.
select tests.decide('changes_requested', '00000000-0000-4000-8000-00000013a003', 'Too late');
select ok(
  (select decision from public.review_requests where entry_id = '00000000-0000-4000-8000-00000013a300') = 'approved',
  'a decided request stays decided'
);

-- ---------------------------------------------------------------------------
-- Another space
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000013b001');
select is(
  (select count(*)::int from public.review_requests where space_id = '00000000-0000-4000-8000-00000013a200'),
  0,
  'an admin of B cannot see A''s review requests'
);
select throws_ok(
  $$select tests.ask_review('00000000-0000-4000-8000-00000013b001')$$,
  '42501', null, 'nor ask for a review of A''s page'
);
select lives_ok(
  $$update public.entries set status = 'published', published_version_id = '00000000-0000-4000-8000-00000013b400', published_at = now()
    where id = '00000000-0000-4000-8000-00000013b300'$$,
  'without approval, publishing is as before'
);

-- ---------------------------------------------------------------------------
-- Agency staff publish with approval on, given a second factor
-- ---------------------------------------------------------------------------
reset role;
update public.entries set status = 'draft', published_version_id = null, published_at = null
where id = '00000000-0000-4000-8000-00000013a300';
select tests.authenticate_as('00000000-0000-4000-8000-00000013c001', 'aal1');
select is(
  (select count(*)::int from public.entries where id = '00000000-0000-4000-8000-00000013a300'),
  0,
  'staff without a second factor do not even see the page'
);
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000013c001', 'aal2');
select lives_ok($$select tests.publish_a()$$, 'staff with a second factor publish');

select * from finish();
rollback;
