-- 0008 API tokens: what client sites send to the Delivery and Preview APIs (package 08).
--
-- A token belongs to one environment of one space; the API resolves the space and environment from the
-- token, never from the URL. The token itself is shown once, when it is created: only its SHA-256 hash is
-- stored, with a short hint (`nv_del_…a1b2`) so people can tell their tokens apart. Delivery tokens start
-- `nv_del_` and read published content; preview tokens start `nv_pre_` and also read drafts.
--
--   table        select                    insert                        update            delete
--   api_tokens   admins, developers, staff admins, developers, as self   revoke, rename    nobody
--
-- Tokens are never deleted, so the audit trail keeps pointing at something; revoking is final. Looking a
-- token up by its hash, and recording when it was last used, is the API's service role.

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  environment_id uuid not null,
  name text not null check (length(trim(name)) > 0 and length(name) <= 120),
  scope text not null check (scope in ('delivery', 'preview')),
  -- Hex SHA-256 of the whole token, prefix included.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- The prefix and the last four characters, e.g. `nv_del_…a1b2`.
  token_hint text not null check (token_hint ~ '^nv_(del|pre)_…[A-Za-z0-9_-]{4}$'),
  last_used_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (environment_id, space_id) references public.environments (id, space_id) on delete cascade,
  check (left(token_hint, 7) = case scope when 'delivery' then 'nv_del_' else 'nv_pre_' end)
);

create index api_tokens_space_id_idx on public.api_tokens (space_id, created_at desc);
create index api_tokens_environment_id_idx on public.api_tokens (environment_id);
create index api_tokens_created_by_idx on public.api_tokens (created_by);

-- Members may rename a token or revoke it, once; nothing else changes. The API's service role also
-- records `last_used_at`.
create function public.api_tokens_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked token stays revoked' using errcode = 'check_violation';
  end if;

  -- `created_by ... on delete set null` when the creator's account is deleted.
  if old.created_by is not null and new.created_by is null
    and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;

  if current_user = 'authenticated' then
    if (to_jsonb(new) - '{name,revoked_at}'::text[]) <> (to_jsonb(old) - '{name,revoked_at}'::text[]) then
      raise exception 'only a token''s name can change, and it can be revoked' using errcode = 'check_violation';
    end if;
  elsif (to_jsonb(new) - '{name,revoked_at,last_used_at}'::text[]) <> (to_jsonb(old) - '{name,revoked_at,last_used_at}'::text[]) then
    raise exception 'a token''s space, environment, scope and secret cannot change' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.api_tokens_guard() from public, anon, authenticated;

create trigger api_tokens_guard
  before update on public.api_tokens
  for each row execute function public.api_tokens_guard();

-- ---------------------------------------------------------------------------
-- Row-level security: tokens are developer business, so editors, authors and viewers never see them.
-- ---------------------------------------------------------------------------
alter table public.api_tokens enable row level security;

create policy "api tokens: admins, developers and agency staff read" on public.api_tokens
  for select to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));

create policy "api tokens: admins, developers and staff create as self" on public.api_tokens
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and revoked_at is null
    and last_used_at is null
    and ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  );

create policy "api tokens: admins, developers and staff rename or revoke" on public.api_tokens
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));

revoke delete, truncate on table public.api_tokens from anon, authenticated;
revoke all on table public.api_tokens from anon;

-- ---------------------------------------------------------------------------
-- Cache tags of published content are scoped to the environment (one CDN zone serves every space), so
-- `type:page` in one space cannot purge another's. Rewrite the tags 06 stored; the API writes the new
-- form from now on (`entry:<id>`, `type:<environment_id>:<api_id>`).
-- ---------------------------------------------------------------------------
update public.published_content
set cache_tags = array['entry:' || entry_id, 'type:' || environment_id || ':' || content_type_api_id];
