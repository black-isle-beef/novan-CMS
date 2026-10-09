-- Localisation (package 16): space_locales, its invariants, and the space's locale prefixes setting.
--
-- Fixture: space A and space B in separate organisations; each starts with its en-GB default locale (0013's trigger).
--   admin_a  admin of A    developer_a  developer of A    editor_a  editor of A    admin_b  admin of B
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- The invariants are checked at commit; the test never commits, so check them at the end of each statement.
set constraints all immediate;

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

-- B's locales as `code>fallback`, whoever asks.
create function tests.locales_b()
returns text[]
language sql
security definer
as $$
  select array_agg(code || '>' || coalesce(fallback_code, '') order by code) from public.space_locales
  where space_id = '00000000-0000-4000-8000-00000016b200';
$$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select tests.create_user('00000000-0000-4000-8000-00000016a001', 'admin-a@l10n.test');
select tests.create_user('00000000-0000-4000-8000-00000016a002', 'developer-a@l10n.test');
select tests.create_user('00000000-0000-4000-8000-00000016a003', 'editor-a@l10n.test');
select tests.create_user('00000000-0000-4000-8000-00000016b001', 'admin-b@l10n.test');

insert into public.organisations (id, name)
values
  ('00000000-0000-4000-8000-00000016a100', 'Org A'),
  ('00000000-0000-4000-8000-00000016b100', 'Org B');

insert into public.spaces (id, organisation_id, name, slug)
values
  ('00000000-0000-4000-8000-00000016a200', '00000000-0000-4000-8000-00000016a100', 'Space A', 'l10n-a'),
  ('00000000-0000-4000-8000-00000016b200', '00000000-0000-4000-8000-00000016b100', 'Space B', 'l10n-b');

insert into public.members (space_id, user_id, role_id)
select r.space_id, m.user_id, r.id
from (
  values
    ('00000000-0000-4000-8000-00000016a200'::uuid, '00000000-0000-4000-8000-00000016a001'::uuid, 'admin'),
    ('00000000-0000-4000-8000-00000016a200'::uuid, '00000000-0000-4000-8000-00000016a002'::uuid, 'developer'),
    ('00000000-0000-4000-8000-00000016a200'::uuid, '00000000-0000-4000-8000-00000016a003'::uuid, 'editor'),
    ('00000000-0000-4000-8000-00000016b200'::uuid, '00000000-0000-4000-8000-00000016b001'::uuid, 'admin')
) as m (space_id, user_id, role_key)
join public.roles r on r.space_id = m.space_id and r.key = m.role_key;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select is(tests.locales_b(), array['en-GB>'], 'a new space starts with its en-GB default locale');
select is(
  (select path_prefix from public.space_locales where space_id = '00000000-0000-4000-8000-00000016b200'),
  'en',
  'whose addresses would start /en'
);

-- ---------------------------------------------------------------------------
-- An admin of A
-- ---------------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-4000-8000-00000016a001');

select lives_ok(
  $$insert into public.space_locales (space_id, code, name, fallback_code, path_prefix)
    values ('00000000-0000-4000-8000-00000016a200', 'fr-FR', 'French (France)', 'en-GB', 'fr')$$,
  'an admin adds French, falling back to English'
);
select throws_ok(
  $$insert into public.space_locales (space_id, code, name, path_prefix)
    values ('00000000-0000-4000-8000-00000016a200', 'French', 'French', 'french')$$,
  '23514', null, 'locale codes are a language and an optional region, like fr-FR'
);
select throws_ok(
  $$insert into public.space_locales (space_id, code, name, path_prefix)
    values ('00000000-0000-4000-8000-00000016a200', 'fr-CA', 'French (Canada)', 'fr')$$,
  '23505', null, 'each locale has its own address prefix'
);
select throws_ok(
  $$insert into public.space_locales (space_id, code, name, fallback_code, path_prefix)
    values ('00000000-0000-4000-8000-00000016a200', 'de-DE', 'German', 'nl-NL', 'de')$$,
  '23503', null, 'a locale falls back only to another locale of the space'
);
select throws_ok(
  $$update public.space_locales set fallback_code = 'fr-FR' where code = 'fr-FR'$$,
  '23514', null, 'not to itself'
);
select lives_ok(
  $$insert into public.space_locales (space_id, code, name, fallback_code, path_prefix)
    values ('00000000-0000-4000-8000-00000016a200', 'fr-CA', 'French (Canada)', 'fr-FR', 'fr-ca')$$,
  'to a locale that falls back in turn'
);
select throws_ok(
  $$update public.space_locales set fallback_code = 'fr-CA' where code = 'fr-FR'$$,
  '23514', 'locales cannot fall back in a circle', 'but never in a circle'
);
select throws_ok(
  $$insert into public.space_locales (space_id, code, name, is_default, path_prefix)
    values ('00000000-0000-4000-8000-00000016a200', 'de-DE', 'German', true, 'de')$$,
  '23514', 'a space has exactly one default locale', 'a space has one default locale'
);
select throws_ok(
  $$update public.space_locales set is_default = false where code = 'en-GB'$$,
  '23514', 'a space has exactly one default locale', 'and always one'
);
select throws_ok(
  $$update public.space_locales set fallback_code = 'fr-FR' where code = 'en-GB'$$,
  '23514', null, 'the default locale falls back to nothing'
);
select lives_ok(
  $$delete from public.space_locales where code = 'fr-FR'$$,
  'removing a locale'
);
select is(
  (select fallback_code from public.space_locales where code = 'fr-CA'),
  null,
  'leaves the locales that fell back to it with no fallback'
);
select throws_ok(
  $$delete from public.space_locales where code = 'en-GB'$$,
  '23514', 'a space has exactly one default locale', 'the default locale cannot be removed'
);
select lives_ok(
  $$update public.spaces set locale_prefixes = true where id = '00000000-0000-4000-8000-00000016a200'$$,
  'an admin turns on locale prefixes'
);

-- Another space's locales: none of these reach B, as checked below.
select throws_ok(
  $$insert into public.space_locales (space_id, code, name, path_prefix)
    values ('00000000-0000-4000-8000-00000016b200', 'cy-GB', 'Welsh', 'cy')$$,
  '42501', null, 'an admin of A cannot add a locale to B'
);
select is(
  (select count(*)::int from public.space_locales where space_id = '00000000-0000-4000-8000-00000016b200'),
  0,
  'nor see B''s locales'
);
update public.space_locales set name = 'Hijacked' where space_id = '00000000-0000-4000-8000-00000016b200';
delete from public.space_locales where space_id = '00000000-0000-4000-8000-00000016b200';

-- ---------------------------------------------------------------------------
-- A developer and an editor of A
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000016a002');
select lives_ok(
  $$insert into public.space_locales (space_id, code, name, fallback_code, path_prefix)
    values ('00000000-0000-4000-8000-00000016a200', 'de-DE', 'German (Germany)', 'en-GB', 'de')$$,
  'a developer adds a locale'
);

reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000016a003');
select is(
  (select array_agg(code order by code) from public.space_locales),
  array['de-DE', 'en-GB', 'fr-CA'],
  'an editor sees the space''s locales'
);
select throws_ok(
  $$insert into public.space_locales (space_id, code, name, path_prefix)
    values ('00000000-0000-4000-8000-00000016a200', 'es-ES', 'Spanish', 'es')$$,
  '42501', null, 'but cannot add one'
);
update public.space_locales set name = 'Changed' where code = 'de-DE';
select is(
  (select name from public.space_locales where code = 'de-DE'),
  'German (Germany)',
  'or rename one'
);
update public.spaces set locale_prefixes = false where id = '00000000-0000-4000-8000-00000016a200';
select is(
  (select locale_prefixes from public.spaces where id = '00000000-0000-4000-8000-00000016a200'),
  true,
  'or change the locale prefixes setting'
);

-- ---------------------------------------------------------------------------
-- Another space
-- ---------------------------------------------------------------------------
reset role;
select tests.authenticate_as('00000000-0000-4000-8000-00000016b001');
select is(
  (select array_agg(code order by code) from public.space_locales),
  array['en-GB'],
  'an admin of B sees only B''s locales'
);
select is(tests.locales_b(), array['en-GB>'], 'which A''s admin could not change or remove');
select is(
  (select name from public.space_locales where code = 'en-GB'),
  'English (UK)',
  'nor rename'
);

-- ---------------------------------------------------------------------------
-- One entry holds every locale
-- ---------------------------------------------------------------------------
reset role;
select hasnt_column('public', 'entries', 'locale', 'entries no longer have a locale of their own');

select * from finish();
rollback;
