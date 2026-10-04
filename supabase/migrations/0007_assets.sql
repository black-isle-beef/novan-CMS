-- 0007 Assets: the media library's files, where published content uses them, and the `media` bucket
-- (package 07).
--
-- Files live in the private `media` bucket at `spaces/<space_id>/<asset_id>/<filename>`. Nobody uploads
-- to the bucket directly: the API signs an upload URL for `spaces/<space_id>/<asset_id>/pending/<filename>`,
-- checks what arrived (type, size, dimensions) and only then moves it into place and creates the asset
-- row. Members read their spaces' objects (the admin shows thumbnails through signed URLs); client sites
-- get published images from the API's image route (`GET /v1/assets/:id/:filename`).
--
--   table          select            insert              update                          delete
--   assets         members, staff    authors and up (1)  editors and up; authors own (2) nobody (purge job, package 17)
--   asset_usages   members, staff    editors and up      nobody                          editors and up
--   storage media  members, staff    nobody (API only)   nobody (API only)               nobody (API only)
--
-- (1) As themselves (`uploaded_by`), and not straight into the bin.
-- (2) An author may describe the files they uploaded (alt text, title, tags, folder, focal point), so they
--     can fill in the alt text publishing asks for. Replacing the file and the bin need an editor; RLS
--     cannot compare old and new rows, so a trigger enforces it.

-- ---------------------------------------------------------------------------
-- Bucket. The API checks the per-plan limits (images 20 MB, other files 50 MB); the bucket refuses
-- anything bigger than 50 MB and any type the library never accepts (HTML, scripts, executables).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf', 'text/plain', 'text/csv', 'application/zip',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  -- `spaces/<space_id>/<id>/<filename>` in the `media` bucket.
  path text not null,
  -- Made safe by the API: letters, numbers, dots, hyphens and underscores.
  filename text not null check (filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$'),
  mime text not null check (mime ~ '^[a-z]+/[a-z0-9.+-]+$'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  -- Images only.
  width integer check (width > 0),
  height integer check (height > 0),
  -- Where to keep in view when cropping, as fractions of the width and height from the top left.
  focal_x real check (focal_x between 0 and 1),
  focal_y real check (focal_y between 0 and 1),
  alt text check (length(alt) <= 500),
  title text check (length(title) <= 200),
  tags text[] not null default '{}'
    check (cardinality(tags) <= 30 and array_position(tags, null) is null),
  -- `Brand/Logos`; null for the top level.
  folder text check (length(folder) between 1 and 200 and folder !~ '(^/|/$|//)'),
  -- Goes up each time the file is replaced, so image URLs change and caches refetch.
  revision integer not null default 1 check (revision > 0),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- In the bin since then; purged after 30 days (package 17).
  deleted_at timestamptz,
  unique (id, space_id),
  check (path = 'spaces/' || space_id || '/' || id || '/' || filename),
  check ((width is null) = (height is null)),
  check ((focal_x is null) = (focal_y is null))
);

create index assets_space_id_created_at_idx on public.assets (space_id, created_at desc);
create index assets_uploaded_by_idx on public.assets (uploaded_by);
create index assets_tags_idx on public.assets using gin (tags);

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- Fixed columns stay fixed; replacing the file and the bin need an editor or above (members acting
-- through the `authenticated` role; the API's service role and background jobs are trusted).
create function public.assets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.space_id <> old.space_id or new.created_at <> old.created_at
    or new.uploaded_by is distinct from old.uploaded_by and new.uploaded_by is not null
  ) then
    raise exception 'an asset''s space, uploader and creation time cannot change' using errcode = 'check_violation';
  end if;

  if current_user <> 'authenticated'
    or (select public.is_agency_staff())
    or (select public.has_space_role(new.space_id, '{admin,developer,editor}')) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.deleted_at is not null then
      raise exception 'only editors can put files in the bin' using errcode = 'insufficient_privilege';
    end if;
  elsif (to_jsonb(new) - '{alt,title,tags,folder,focal_x,focal_y,updated_at}'::text[])
    <> (to_jsonb(old) - '{alt,title,tags,folder,focal_x,focal_y,updated_at}'::text[]) then
    raise exception 'only editors can replace files or use the bin' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.assets_guard() from public, anon, authenticated;

create trigger assets_guard
  before insert or update on public.assets
  for each row execute function public.assets_guard();

-- ---------------------------------------------------------------------------
-- asset_usages: which published entries use which asset, rewritten on every publish and removed on
-- unpublish. The library's "in use on N pages" warning and the image route both read it.
-- ---------------------------------------------------------------------------
create table public.asset_usages (
  asset_id uuid not null,
  entry_id uuid not null,
  space_id uuid not null references public.spaces (id) on delete cascade,
  -- Where in the entry's data, with blocks named by `_uid`, e.g. `body.<uid>.image` or `gallery.2`.
  field_path text not null check (length(field_path) between 1 and 500),
  primary key (asset_id, entry_id, field_path),
  foreign key (asset_id, space_id) references public.assets (id, space_id) on delete cascade,
  foreign key (entry_id, space_id) references public.entries (id, space_id) on delete cascade
);

create index asset_usages_entry_id_idx on public.asset_usages (entry_id);
create index asset_usages_space_id_idx on public.asset_usages (space_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.assets enable row level security;
alter table public.asset_usages enable row level security;

-- assets
create policy "assets: members and agency staff read" on public.assets
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "assets: authors and up add their own" on public.assets
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')))
  );

create policy "assets: editors and up, or the author who uploaded it, update" on public.assets
  for update to authenticated
  using (
    (select public.is_agency_staff())
    or (select public.has_space_role(space_id, '{admin,developer,editor}'))
    or (uploaded_by = (select auth.uid()) and (select public.has_space_role(space_id, '{author}')))
  )
  with check (
    (select public.is_agency_staff())
    or (select public.has_space_role(space_id, '{admin,developer,editor}'))
    or (uploaded_by = (select auth.uid()) and (select public.has_space_role(space_id, '{author}')))
  );

revoke delete, truncate on table public.assets from anon, authenticated;

-- asset_usages
create policy "asset usages: members and agency staff read" on public.asset_usages
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "asset usages: editors and up add" on public.asset_usages
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

create policy "asset usages: editors and up remove" on public.asset_usages
  for delete to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

revoke update, truncate on table public.asset_usages from anon, authenticated;
revoke all on table public.assets, public.asset_usages from anon;

-- ---------------------------------------------------------------------------
-- Storage: members read their spaces' files. The second path segment is the space id; writes go
-- through the API's service role only, so there are no insert, update or delete policies.
-- ---------------------------------------------------------------------------
create policy "media: members and agency staff read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'spaces'
    and (
      (storage.foldername(name))[2] = any((select public.auth_space_ids())::text[])
      or (select public.is_agency_staff())
    )
  );
