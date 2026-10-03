-- 0005 Content model: content types and block types, defined per environment (package 05).
--
-- Field definitions (`fields`) and style options (`style_options`) are JSON validated by the API with
-- the Zod schemas in libs/shared/schemas (fields.ts, content-model.ts); the database checks only
-- their outer shape.
--
--   table          select                      insert / update / delete
--   content_types  members, agency staff       space admins and developers, agency staff
--   block_types    members, agency staff       space admins and developers, agency staff

-- ---------------------------------------------------------------------------
-- updated_at, shared by tables that track their last change.
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- content_types
-- ---------------------------------------------------------------------------
create table public.content_types (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  environment_id uuid not null,
  api_id text not null check (api_id ~ '^[a-z][a-zA-Z0-9]*$' and length(api_id) <= 64),
  name text not null check (length(trim(name)) > 0),
  kind text not null check (kind in ('page', 'entry', 'singleton')),
  description text,
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment_id, api_id),
  -- Target for same-space composite foreign keys (entries, package 06).
  unique (id, space_id),
  -- The environment must belong to the same space.
  foreign key (environment_id, space_id) references public.environments (id, space_id) on delete cascade
);

create index content_types_space_id_idx on public.content_types (space_id);

create trigger content_types_set_updated_at
  before update on public.content_types
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- block_types
-- ---------------------------------------------------------------------------
create table public.block_types (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  environment_id uuid not null,
  api_id text not null check (api_id ~ '^[a-z][a-zA-Z0-9]*$' and length(api_id) <= 64),
  name text not null check (length(trim(name)) > 0),
  -- A Bootstrap Icons name.
  icon text check (icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  preview_image_path text,
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  allowed_children text[] not null default '{}',
  style_options jsonb not null default '{}'::jsonb check (jsonb_typeof(style_options) = 'object'),
  -- Raised by the API whenever fields, allowed children or style options change.
  schema_version int not null default 1 check (schema_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment_id, api_id),
  unique (id, space_id),
  foreign key (environment_id, space_id) references public.environments (id, space_id) on delete cascade
);

create index block_types_space_id_idx on public.block_types (space_id);

create trigger block_types_set_updated_at
  before update on public.block_types
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: members read, admins and developers model.
-- ---------------------------------------------------------------------------
alter table public.content_types enable row level security;
alter table public.block_types enable row level security;

create policy "content types: members and agency staff read" on public.content_types
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "content types: admins, developers and agency staff write" on public.content_types
  for all to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));

create policy "block types: members and agency staff read" on public.block_types
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "block types: admins, developers and agency staff write" on public.block_types
  for all to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));

revoke all on table public.content_types, public.block_types from anon;
