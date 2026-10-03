-- 0006 Entries: folders, entries, their versions and the published copy (package 06).
--
-- Entry data (`entry_versions.data`) is JSON validated by the API with `buildEntrySchema` from
-- libs/shared/schemas; the database checks only its outer shape.
--
--   table              select            insert                   update                      delete
--   folders            members, staff    authors and up           editors and up              editors and up
--   entries            members, staff    authors and up (1)       authors and up (1)          nobody (purge job, package 17)
--   entry_versions     members, staff    authors and up, as self  own recent autosave (2)     nobody
--   published_content  members, staff    editors and up           editors and up              editors and up
--
-- "Authors and up" is admin, developer, editor and author; "editors and up" drops author. Agency staff
-- count only at AAL2, as everywhere else.
--
-- (1) Publishing (status, published_version_id, published_at) and the bin (deleted_at) need an editor or
--     above. RLS cannot compare old and new rows, so a trigger enforces it.
-- (2) Versions are immutable. The one exception is autosave: the author's own autosaved version may
--     have its data overwritten while it is the entry's current, unpublished version and less than two
--     minutes old, so autosave does not create a version every few seconds.

-- ---------------------------------------------------------------------------
-- Same-environment foreign keys need (id, environment_id) targets.
-- ---------------------------------------------------------------------------
alter table public.content_types add unique (id, environment_id);

-- ---------------------------------------------------------------------------
-- folders
-- ---------------------------------------------------------------------------
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  environment_id uuid not null,
  parent_id uuid,
  name text not null check (length(trim(name)) > 0 and length(name) <= 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 100),
  -- `/parent-slug/slug`, maintained by trigger.
  path text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment_id, path),
  unique (id, space_id),
  unique (id, environment_id),
  foreign key (environment_id, space_id) references public.environments (id, space_id) on delete cascade,
  -- A parent folder must be in the same environment (and so the same space). A folder with
  -- subfolders cannot be deleted; deleting the environment removes them all at once.
  foreign key (parent_id, environment_id) references public.folders (id, environment_id)
);

create index folders_space_id_idx on public.folders (space_id);
create index folders_parent_id_idx on public.folders (parent_id);

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

-- Path from the parent's path and the slug; refuses to move a folder inside itself.
create function public.folders_set_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_path text;
begin
  if new.parent_id is null then
    new.path := '/' || new.slug;
    return new;
  end if;

  select f.path into parent_path from public.folders f where f.id = new.parent_id;
  if parent_path is null then
    raise exception 'parent folder % not found', new.parent_id using errcode = 'foreign_key_violation';
  end if;
  if tg_op = 'UPDATE' and (parent_path = old.path or starts_with(parent_path, old.path || '/')) then
    raise exception 'a folder cannot move inside itself' using errcode = 'check_violation';
  end if;

  new.path := parent_path || '/' || new.slug;
  return new;
end;
$$;

revoke execute on function public.folders_set_path() from public, anon, authenticated;

create trigger folders_set_path
  before insert or update of parent_id, slug on public.folders
  for each row execute function public.folders_set_path();

-- A new path flows down to subfolders (each recomputes its own) and to published addresses below it.
create function public.folders_cascade_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.folders set parent_id = parent_id where parent_id = new.id;
  update public.published_content
  set full_path = new.path || substr(full_path, length(old.path) + 1)
  where environment_id = new.environment_id and starts_with(full_path, old.path || '/');
  return null;
end;
$$;

revoke execute on function public.folders_cascade_path() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- entries
-- ---------------------------------------------------------------------------
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  environment_id uuid not null,
  content_type_id uuid not null,
  folder_id uuid,
  -- The last part of the address. Kept equal to the current version's `slug` field when the type has one.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 100),
  locale text not null check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'scheduled', 'published', 'archived')),
  current_version_id uuid,
  published_version_id uuid,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- In the bin since then; purged after 30 days (package 17).
  deleted_at timestamptz,
  unique (id, space_id),
  unique (id, environment_id),
  foreign key (environment_id, space_id) references public.environments (id, space_id) on delete cascade,
  -- Deleting a content type (forced, package 05) deletes its entries.
  foreign key (content_type_id, environment_id) references public.content_types (id, environment_id) on delete cascade,
  foreign key (folder_id, environment_id) references public.folders (id, environment_id),
  check (status <> 'published' or (published_version_id is not null and published_at is not null))
);

-- One live entry per address and locale; the root folder (null) counts as one folder.
create unique index entries_address_idx on public.entries (environment_id, folder_id, slug, locale)
  nulls not distinct where deleted_at is null;
create index entries_space_id_idx on public.entries (space_id);
create index entries_content_type_id_idx on public.entries (content_type_id);
create index entries_folder_id_idx on public.entries (folder_id);

create trigger entries_set_updated_at
  before update on public.entries
  for each row execute function public.set_updated_at();

-- Fixed columns stay fixed; publishing and the bin need an editor or above (members acting through
-- the `authenticated` role; the API's service role and background jobs are trusted).
create function public.entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.space_id <> old.space_id or new.environment_id <> old.environment_id
    or new.content_type_id <> old.content_type_id or new.locale <> old.locale
    or new.created_by is distinct from old.created_by and new.created_by is not null
    or new.created_at <> old.created_at
  ) then
    raise exception 'an entry''s space, environment, type, locale and creator cannot change'
      using errcode = 'check_violation';
  end if;

  if current_user <> 'authenticated'
    or (select public.is_agency_staff())
    or (select public.has_space_role(new.space_id, '{admin,developer,editor}')) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.published_version_id is not null or new.published_at is not null
      or new.deleted_at is not null then
      raise exception 'only editors can create published or deleted entries' using errcode = 'insufficient_privilege';
    end if;
  elsif new.status is distinct from old.status
    or new.published_version_id is distinct from old.published_version_id
    or new.published_at is distinct from old.published_at
    or new.deleted_at is distinct from old.deleted_at then
    raise exception 'only editors can publish, unpublish, delete or restore entries' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.entries_guard() from public, anon, authenticated;

create trigger entries_guard
  before insert or update on public.entries
  for each row execute function public.entries_guard();

-- ---------------------------------------------------------------------------
-- entry_versions
-- ---------------------------------------------------------------------------
create table public.entry_versions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  space_id uuid not null references public.spaces (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  message text check (length(message) <= 500),
  -- Written by autosave rather than an explicit save; see the note at the top.
  autosave boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, entry_id),
  foreign key (entry_id, space_id) references public.entries (id, space_id) on delete cascade
);

create index entry_versions_entry_id_created_at_idx on public.entry_versions (entry_id, created_at desc);
create index entry_versions_space_id_idx on public.entry_versions (space_id);
create index entry_versions_created_by_idx on public.entry_versions (created_by);

-- An entry points only at its own versions.
alter table public.entries
  add foreign key (current_version_id, id) references public.entry_versions (id, entry_id),
  add foreign key (published_version_id, id) references public.entry_versions (id, entry_id);

-- Versions are immutable, apart from a recent autosave and losing a deleted author. They disappear
-- only with their entry or space.
create function public.entry_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.entries where id = old.entry_id)
      or not exists (select 1 from public.spaces where id = old.space_id) then
      return old;
    end if;
    raise exception 'entry versions cannot be deleted' using errcode = 'insufficient_privilege';
  end if;

  -- `created_by ... on delete set null` when the author's account is deleted.
  if old.created_by is not null and new.created_by is null
    and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;

  -- Autosave overwrites its own recent version's data, and nothing else.
  if old.autosave
    and (to_jsonb(new) - 'data') = (to_jsonb(old) - 'data')
    and old.created_by = (select auth.uid())
    and old.created_at > now() - interval '2 minutes'
    and exists (
      select 1 from public.entries e
      where e.id = old.entry_id and e.current_version_id = old.id and e.published_version_id is distinct from old.id
    ) then
    return new;
  end if;

  raise exception 'entry versions are immutable' using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.entry_versions_guard() from public, anon, authenticated;

create trigger entry_versions_guard
  before update or delete on public.entry_versions
  for each row execute function public.entry_versions_guard();

revoke delete, truncate on table public.entry_versions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- published_content: what the Delivery API serves (package 08), one row per published entry.
-- ---------------------------------------------------------------------------
create table public.published_content (
  entry_id uuid primary key,
  space_id uuid not null references public.spaces (id) on delete cascade,
  environment_id uuid not null,
  content_type_api_id text not null,
  -- Folder path and slug as published, e.g. `/blog/hello-world`.
  full_path text not null check (full_path ~ '^(/[a-z0-9]+(-[a-z0-9]+)*)+$'),
  locale text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  published_at timestamptz not null,
  cache_tags text[] not null default '{}',
  foreign key (entry_id, space_id) references public.entries (id, space_id) on delete cascade,
  foreign key (entry_id, environment_id) references public.entries (id, environment_id) on delete cascade,
  foreign key (environment_id, space_id) references public.environments (id, space_id) on delete cascade
);

create unique index published_content_address_idx on public.published_content (environment_id, locale, full_path);
create index published_content_space_id_idx on public.published_content (space_id);

-- Declared after published_content exists.
create trigger folders_cascade_path
  after update on public.folders
  for each row when (old.path is distinct from new.path)
  execute function public.folders_cascade_path();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.folders enable row level security;
alter table public.entries enable row level security;
alter table public.entry_versions enable row level security;
alter table public.published_content enable row level security;

-- folders
create policy "folders: members and agency staff read" on public.folders
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "folders: authors and up create" on public.folders
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')));

-- Renaming or moving a folder changes published addresses, so it needs an editor.
create policy "folders: editors and up update" on public.folders
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

create policy "folders: editors and up delete" on public.folders
  for delete to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

-- entries
create policy "entries: members and agency staff read" on public.entries
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "entries: authors and up create" on public.entries
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')));

create policy "entries: authors and up update" on public.entries
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')));

revoke delete, truncate on table public.entries from anon, authenticated;

-- entry_versions
create policy "entry versions: members and agency staff read" on public.entry_versions
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "entry versions: authors and up create their own" on public.entry_versions
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')))
  );

create policy "entry versions: authors overwrite their own autosave" on public.entry_versions
  for update to authenticated
  using (
    created_by = (select auth.uid())
    and ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')))
  )
  with check (
    created_by = (select auth.uid())
    and ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')))
  );

-- published_content
create policy "published content: members and agency staff read" on public.published_content
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "published content: editors and up write" on public.published_content
  for all to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

revoke all on table public.folders, public.entries, public.entry_versions, public.published_content from anon;
