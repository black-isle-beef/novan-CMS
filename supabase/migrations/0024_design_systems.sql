-- 0024 Design systems (docs/build/24-design-systems.md): CSS frameworks and design systems a space uploads, their
-- versions, the classes and components each version has, and which versions the space's site loads.
--
--   table                     select            insert                 update                 delete
--   design_systems            members, staff    admins, developers     admins, developers     admins, developers
--   design_system_versions    members, staff    admins, developers (1) admins, developers (2) nobody (3)
--   design_system_components  members, staff    the API (4)            the API (4)            the API (4)
--   design_system_classes     members, staff    the API (4)            the API (4)            the API (4)
--   space_design_systems      members, staff    admins, developers (5) admins, developers     admins, developers
--
-- Agency staff count only at AAL2, as everywhere.
--
-- (1) A version starts as `uploaded`, with nothing but its version number, source and author.
-- (2) Members change a version's status only, and only from `uploaded` to `validating` (the upload is complete) or
--     from `ready` to `deprecated`. Its manifest, files, report and every other status come from the API's upload
--     worker, as the service role. A `ready` version's files never change: a change is a new version.
-- (3) Versions go with their design system.
-- (4) Written by the upload worker as the service role, from the processed files.
-- (5) Only a `ready` version can be attached; a version that is deprecated later stays attached until replaced.
--
-- Files live in the private `design-systems` bucket at `spaces/<space_id>/<design_system_id>/<version_id>/...`:
-- the upload at `pending/<filename>`, the processed files under `files/`. As with `media`, nobody writes to the
-- bucket directly; members read their spaces' files.
--
-- `spaces.settings.designSystems` (`enabled`, `customCss`) turns the feature on for a space. Like the media
-- settings (0023), only agency staff change it.

-- ---------------------------------------------------------------------------
-- design_systems
-- ---------------------------------------------------------------------------
create table public.design_systems (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  framework text not null check (framework in ('css', 'tailwind', 'bootstrap', 'web-components')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, slug),
  unique (id, space_id)
);

create index design_systems_created_by_idx on public.design_systems (created_by);

create trigger design_systems_set_updated_at
  before update on public.design_systems
  for each row execute function public.set_updated_at();

-- Members cannot move a design system to another space, or change who made it.
create function public.design_systems_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is distinct from (select auth.uid()) then
      raise exception 'a design system is added as the person adding it' using errcode = 'insufficient_privilege';
    end if;
  elsif new.space_id <> old.space_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'a design system''s space and author cannot change' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.design_systems_guard() from public, anon, authenticated;

create trigger design_systems_guard
  before insert or update on public.design_systems
  for each row execute function public.design_systems_guard();

-- ---------------------------------------------------------------------------
-- design_system_versions
-- ---------------------------------------------------------------------------
create table public.design_system_versions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  design_system_id uuid not null,
  version text not null check (
    version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$' and length(version) <= 64
  ),
  status text not null default 'uploaded' check (status in ('uploaded', 'validating', 'invalid', 'ready', 'deprecated')),
  -- What was uploaded: a stylesheet, a zip package (24d), or a stylesheet fetched from `source_url`.
  source text not null check (source in ('css', 'zip', 'url')),
  source_url text check (source_url ~ '^https://[^[:space:]]+$' and length(source_url) <= 2048),
  -- The file name of an uploaded stylesheet or package, as the browser sent it (after the API made it safe).
  filename text check (filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$'),
  manifest jsonb check (manifest is null or jsonb_typeof(manifest) = 'object'),
  -- Processed stylesheets and scripts, in load order, as paths under the version's `files/`.
  css_entry text[] not null default '{}',
  js_entry text[] not null default '{}',
  validation_report jsonb check (validation_report is null or jsonb_typeof(validation_report) = 'object'),
  -- SHA-256 of the upload, hex.
  checksum text check (checksum ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (design_system_id, version),
  unique (id, space_id),
  unique (id, design_system_id, space_id),
  check ((source = 'url') = (source_url is not null)),
  check ((source = 'url') or filename is not null),
  foreign key (design_system_id, space_id) references public.design_systems (id, space_id) on delete cascade
);

create index design_system_versions_space_id_idx on public.design_system_versions (space_id);
create index design_system_versions_created_by_idx on public.design_system_versions (created_by);

create function public.design_system_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('ready', 'deprecated') and (
    new.manifest is distinct from old.manifest
    or new.css_entry is distinct from old.css_entry
    or new.js_entry is distinct from old.js_entry
    or new.checksum is distinct from old.checksum
    or new.version <> old.version
    or new.status not in ('ready', 'deprecated')
  ) then
    raise exception 'a ready design system version cannot change; upload a new version' using errcode = 'check_violation';
  end if;
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is distinct from (select auth.uid()) then
      raise exception 'a version is added as the person adding it' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'uploaded' or new.manifest is not null or new.validation_report is not null or new.checksum is not null
       or new.css_entry <> '{}' or new.js_entry <> '{}' or new.processed_at is not null then
      raise exception 'a new version starts empty, as uploaded' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
     or not ((old.status = 'uploaded' and new.status = 'validating')
             or (old.status = 'ready' and new.status = 'deprecated')
             or new.status = old.status) then
    raise exception 'members only mark an upload complete or deprecate a ready version' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.design_system_versions_guard() from public, anon, authenticated;

create trigger design_system_versions_guard
  before insert or update on public.design_system_versions
  for each row execute function public.design_system_versions_guard();

-- ---------------------------------------------------------------------------
-- design_system_components (filled from zip packages, 24d)
-- ---------------------------------------------------------------------------
create table public.design_system_components (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  version_id uuid not null,
  component_key text not null check (component_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(component_key) <= 64),
  tag text check (tag ~ '^[a-z][a-z0-9._]*-[a-z0-9._-]*$' and length(tag) <= 64),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  unique (version_id, component_key),
  unique (id, space_id),
  foreign key (version_id, space_id) references public.design_system_versions (id, space_id) on delete cascade
);

create index design_system_components_space_id_idx on public.design_system_components (space_id);

-- ---------------------------------------------------------------------------
-- design_system_classes: every class a version's stylesheets define, for the editor's autocomplete
-- ---------------------------------------------------------------------------
create table public.design_system_classes (
  version_id uuid not null,
  space_id uuid not null,
  class_name text not null check (length(class_name) between 1 and 120),
  class_group text check (class_group ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(class_group) <= 40),
  source_file text not null check (length(source_file) <= 200),
  primary key (version_id, class_name),
  foreign key (version_id, space_id) references public.design_system_versions (id, space_id) on delete cascade
);

create index design_system_classes_space_id_idx on public.design_system_classes (space_id);
-- Prefix search (`btn` finds `btn-primary`), and the class browser's groups.
create index design_system_classes_prefix_idx on public.design_system_classes (version_id, class_name text_pattern_ops);
create index design_system_classes_group_idx on public.design_system_classes (version_id, class_group, class_name);

-- ---------------------------------------------------------------------------
-- space_design_systems: the versions a space's site loads, per environment, in order
-- ---------------------------------------------------------------------------
create table public.space_design_systems (
  space_id uuid not null,
  environment_id uuid not null,
  design_system_id uuid not null,
  version_id uuid not null,
  load_order int not null check (load_order between 0 and 99),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (environment_id, version_id),
  -- One version of each design system at a time; upgrading replaces it.
  unique (environment_id, design_system_id),
  foreign key (environment_id, space_id) references public.environments (id, space_id) on delete cascade,
  foreign key (version_id, design_system_id, space_id)
    references public.design_system_versions (id, design_system_id, space_id) on delete cascade
);

create index space_design_systems_space_id_idx on public.space_design_systems (space_id);
create index space_design_systems_version_id_idx on public.space_design_systems (version_id);

create function public.space_design_systems_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.version_id <> old.version_id)
     and (select status from public.design_system_versions where id = new.version_id) <> 'ready' then
    raise exception 'only a ready design system version can be attached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.space_design_systems_guard() from public, anon, authenticated;

create trigger space_design_systems_guard
  before insert or update on public.space_design_systems
  for each row execute function public.space_design_systems_guard();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.design_systems enable row level security;
alter table public.design_system_versions enable row level security;
alter table public.design_system_components enable row level security;
alter table public.design_system_classes enable row level security;
alter table public.space_design_systems enable row level security;

create policy "design systems: members and agency staff read" on public.design_systems
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));
create policy "design systems: admins and developers add" on public.design_systems
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));
create policy "design systems: admins and developers change" on public.design_systems
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));
create policy "design systems: admins and developers remove" on public.design_systems
  for delete to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));

create policy "design system versions: members and agency staff read" on public.design_system_versions
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));
create policy "design system versions: admins and developers add" on public.design_system_versions
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));
create policy "design system versions: admins and developers change status" on public.design_system_versions
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));

create policy "design system components: members and agency staff read" on public.design_system_components
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "design system classes: members and agency staff read" on public.design_system_classes
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "space design systems: members and agency staff read" on public.space_design_systems
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));
create policy "space design systems: admins and developers attach" on public.space_design_systems
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));
create policy "space design systems: admins and developers change" on public.space_design_systems
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));
create policy "space design systems: admins and developers detach" on public.space_design_systems
  for delete to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));

revoke all on public.design_systems, public.design_system_versions, public.design_system_components,
  public.design_system_classes, public.space_design_systems from anon;
grant select, insert, update, delete on public.design_systems, public.space_design_systems to authenticated;
grant select, insert, update on public.design_system_versions to authenticated;
revoke delete on public.design_system_versions from authenticated;
grant select on public.design_system_components, public.design_system_classes to authenticated;
revoke insert, update, delete on public.design_system_components, public.design_system_classes from authenticated;

-- ---------------------------------------------------------------------------
-- Feature flags: `spaces.settings.designSystems`, changed by agency staff only (as `settings.media`, 0023)
-- ---------------------------------------------------------------------------
create function public.guard_space_design_system_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.settings -> 'designSystems') is distinct from (old.settings -> 'designSystems')
     and current_user in ('authenticated', 'anon')
     and not (select public.is_agency_staff()) then
    raise exception 'only agency staff turn design systems on for a space'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_space_design_system_settings() from public, anon, authenticated;

create trigger spaces_guard_design_system_settings
before update of settings on public.spaces
for each row execute function public.guard_space_design_system_settings();

-- ---------------------------------------------------------------------------
-- Bucket. The API checks its own, lower limits (docs/build/24-design-systems.md); the bucket refuses anything
-- bigger than 26 MB and any type a design system package never holds.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'design-systems',
  'design-systems',
  false,
  27262976,
  array[
    'text/css', 'application/zip', 'text/javascript', 'application/json',
    'font/woff', 'font/woff2', 'font/ttf', 'font/otf',
    'image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "design systems: members and agency staff read files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'design-systems'
    and (storage.foldername(name))[1] = 'spaces'
    and (
      (storage.foldername(name))[2] = any((select public.auth_space_ids())::text[])
      or (select public.is_agency_staff())
    )
  );

-- ---------------------------------------------------------------------------
-- Queue: uploads are processed by the API's worker (`design-systems:process-version`).
-- ---------------------------------------------------------------------------
select pgmq.create('design-systems');

revoke all on all tables in schema pgmq from public, anon, authenticated, service_role;
revoke all on all sequences in schema pgmq from public, anon, authenticated, service_role;
