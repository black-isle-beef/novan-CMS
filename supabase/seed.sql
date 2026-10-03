-- Local development seed. Runs after migrations on `supabase db reset`.
-- Never run this against staging or production: it creates users with a known password.

-- ---------------------------------------------------------------------------
-- Users (password: password123)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'agency@novan.test',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{"display_name": "Agency User"}', now(), now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'client@novan.test',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{"display_name": "Client User"}', now(), now(),
    '', '', '', ''
  );

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email in ('agency@novan.test', 'client@novan.test');

insert into public.profiles (user_id, display_name, is_agency_staff)
values
  ('00000000-0000-4000-8000-000000000001', 'Agency User', true),
  ('00000000-0000-4000-8000-000000000002', 'Client User', false);

-- ---------------------------------------------------------------------------
-- Organisation and space (the space trigger creates `main` and the default roles)
-- ---------------------------------------------------------------------------
insert into public.organisations (id, name)
values ('00000000-0000-4000-8000-000000000100', 'Novan Web Services');

insert into public.spaces (id, organisation_id, name, slug, preview_url)
values (
  '00000000-0000-4000-8000-000000000200', '00000000-0000-4000-8000-000000000100',
  'Demo site', 'demo-site', 'http://localhost:4300'
);

insert into public.members (space_id, user_id, role_id, invited_by)
select s.id, m.user_id, r.id, m.invited_by
from public.spaces s
cross join (
  values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'admin', null::uuid),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'editor', '00000000-0000-4000-8000-000000000001'::uuid)
) as m (user_id, role_key, invited_by)
join public.roles r on r.space_id = s.id and r.key = m.role_key
where s.slug = 'demo-site';
