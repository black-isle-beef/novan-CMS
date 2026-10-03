-- 0001 Tenancy: organisations, spaces, environments, roles, members, profiles.
--
-- RLS is enabled on every table with no policies, so nothing is readable by
-- `anon` or `authenticated` until package 03 adds them.

-- ---------------------------------------------------------------------------
-- organisations
-- ---------------------------------------------------------------------------
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  plan text not null default 'agency',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- spaces (the tenant boundary)
-- ---------------------------------------------------------------------------
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  default_locale text not null default 'en-GB',
  preview_url text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index spaces_organisation_id_idx on public.spaces (organisation_id);

-- ---------------------------------------------------------------------------
-- environments
-- ---------------------------------------------------------------------------
create table public.environments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  is_main boolean not null default false,
  cloned_from_id uuid,
  created_at timestamptz not null default now(),
  unique (space_id, name),
  -- Target for same-space composite foreign keys.
  unique (id, space_id),
  -- An environment can only be cloned from another environment in the same space.
  foreign key (cloned_from_id, space_id) references public.environments (id, space_id) on delete set null (cloned_from_id)
);

-- Exactly one main environment per space.
create unique index environments_one_main_per_space_idx on public.environments (space_id) where is_main;

-- ---------------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  permissions jsonb not null default '{}'::jsonb,
  unique (space_id, key),
  -- Target for same-space composite foreign keys.
  unique (id, space_id)
);

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create table public.members (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id),
  -- A member's role must belong to the same space.
  foreign key (role_id, space_id) references public.roles (id, space_id) on delete restrict
);

create index members_user_id_idx on public.members (user_id);
create index members_role_id_idx on public.members (role_id);

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  is_agency_staff boolean not null default false
);

-- ---------------------------------------------------------------------------
-- New space: create its main environment and default roles.
-- security definer so it still works once RLS policies restrict the caller.
-- ---------------------------------------------------------------------------
create function public.handle_new_space()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.environments (space_id, name, is_main)
  values (new.id, 'main', true);

  insert into public.roles (space_id, key, name, permissions)
  values
    (new.id, 'admin', 'Admin', '{
      "space": ["read", "update"],
      "members": ["read", "invite", "update", "remove"],
      "schema": ["read", "write"],
      "content": ["read", "create", "update", "delete", "publish"],
      "media": ["read", "upload", "update", "delete"],
      "settings": ["read", "update"],
      "audit": ["read"]
    }'::jsonb),
    (new.id, 'developer', 'Developer', '{
      "space": ["read"],
      "members": ["read"],
      "schema": ["read", "write"],
      "content": ["read", "create", "update", "delete", "publish"],
      "media": ["read", "upload", "update", "delete"],
      "settings": ["read", "update"]
    }'::jsonb),
    (new.id, 'editor', 'Editor', '{
      "space": ["read"],
      "schema": ["read"],
      "content": ["read", "create", "update", "delete", "publish"],
      "media": ["read", "upload", "update", "delete"]
    }'::jsonb),
    (new.id, 'author', 'Author', '{
      "space": ["read"],
      "schema": ["read"],
      "content": ["read", "create", "update"],
      "media": ["read", "upload"]
    }'::jsonb),
    (new.id, 'viewer', 'Viewer', '{
      "space": ["read"],
      "schema": ["read"],
      "content": ["read"],
      "media": ["read"]
    }'::jsonb);

  return new;
end;
$$;

revoke execute on function public.handle_new_space() from public, anon, authenticated;

create trigger on_space_created
  after insert on public.spaces
  for each row execute function public.handle_new_space();

-- ---------------------------------------------------------------------------
-- Row-level security: enabled everywhere, policies arrive in 0004 (package 03).
-- ---------------------------------------------------------------------------
alter table public.organisations enable row level security;
alter table public.spaces enable row level security;
alter table public.environments enable row level security;
alter table public.roles enable row level security;
alter table public.members enable row level security;
alter table public.profiles enable row level security;
