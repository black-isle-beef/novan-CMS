-- 0003 Auth: custom access token claims, claim helpers and profile creation.
--
-- Every access token carries
--   spaces:       [{ "id": <space uuid>, "role": <role key> }]  (from members + roles)
--   agency_staff: boolean                                       (from profiles)
-- RLS policies (0004) and the API guards read these claims, so both agree on access.
-- Claims are refreshed when the token is: a membership change reaches a user's token on their
-- next refresh (at most `auth.jwt_expiry` later).

-- ---------------------------------------------------------------------------
-- Custom access token hook (enabled in config.toml under [auth.hook.custom_access_token]).
-- Runs as supabase_auth_admin, which gets read access to the three tables it needs below.
-- ---------------------------------------------------------------------------
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := (event ->> 'user_id')::uuid;
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  space_claims jsonb;
  agency_staff boolean;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', m.space_id, 'role', r.key) order by m.created_at), '[]'::jsonb)
  into space_claims
  from public.members m
  join public.roles r on r.id = m.role_id and r.space_id = m.space_id
  where m.user_id = uid;

  select coalesce(p.is_agency_staff, false)
  into agency_staff
  from public.profiles p
  where p.user_id = uid;

  claims := claims
    || jsonb_build_object('spaces', space_claims)
    || jsonb_build_object('agency_staff', coalesce(agency_staff, false));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

grant usage on schema public to supabase_auth_admin;
grant select on table public.members, public.roles, public.profiles to supabase_auth_admin;

create policy "auth hook reads members" on public.members
  as permissive for select to supabase_auth_admin using (true);
create policy "auth hook reads roles" on public.roles
  as permissive for select to supabase_auth_admin using (true);
create policy "auth hook reads profiles" on public.profiles
  as permissive for select to supabase_auth_admin using (true);

-- ---------------------------------------------------------------------------
-- Claim helpers for RLS policies. They read only the verified JWT (`auth.jwt()`), never tables,
-- so policies using them cannot recurse.
-- ---------------------------------------------------------------------------

-- Spaces the caller is a member of.
create function public.auth_space_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg((s ->> 'id')::uuid), '{}'::uuid[])
  from jsonb_array_elements(
    case when jsonb_typeof(auth.jwt() -> 'spaces') = 'array' then auth.jwt() -> 'spaces' else '[]'::jsonb end
  ) as s;
$$;

-- Whether the caller holds one of `roles` (role keys, e.g. '{admin}') in `space`.
create function public.has_space_role(space uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'spaces') = 'array' then auth.jwt() -> 'spaces' else '[]'::jsonb end
    ) as s
    where (s ->> 'id')::uuid = space and (s ->> 'role') = any(roles)
  );
$$;

-- Agency staff privileges need a second factor (AAL2): a password-only session is treated as a
-- regular member. The API guard applies the same rule.
create function public.is_agency_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'agency_staff')::boolean, false)
    and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke execute on function public.auth_space_ids() from public, anon;
revoke execute on function public.has_space_role(uuid, text[]) from public, anon;
revoke execute on function public.is_agency_staff() from public, anon;
grant execute on function public.auth_space_ids() to authenticated, service_role;
grant execute on function public.has_space_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.is_agency_staff() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Every new auth user (sign-up or invite) gets a profile. Agency staff is never set here.
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), new.email))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
