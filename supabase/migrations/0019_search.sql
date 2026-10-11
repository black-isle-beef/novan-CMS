-- 0019 Search (docs/build/18-search-forms-audit.md): Postgres full-text search for the Delivery and Preview APIs and the
-- admin's global search.
--
--   published_content.search  generated: what the Delivery API searches (published pages and entries)
--   entry_search              one row per entry, its current version (drafts): Preview API and admin search
--   assets.search             generated: the admin's media search
--
-- Text comes from entry data with `search_text()`: every string a visitor would read (text fields, rich text, block
-- fields, link text), and none that are machinery (`_uid`, block names, ids, addresses, node types). A translated value
-- (`{ "en-GB": ..., "fr-FR": ... }`, 0013) counts in every locale, so one vector serves them all; snippets are cut from
-- the requested locale's text. Words are stemmed with the `english` configuration (the default locale of every space
-- so far is en-GB); a search engine with per-language analysis can replace this behind the API's SearchProvider.
--
-- Weights: A the title (or name), B the SEO title and description (and, for drafts, the slug), C everything else.

-- ---------------------------------------------------------------------------
-- Text extraction
-- ---------------------------------------------------------------------------

-- Keys whose values are never read as text by visitors.
create function public.search_skipped_key(key text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select starts_with(key, '_') or key = any (array[
    'type', 'attrs', 'marks', 'assetId', 'entryId', 'href', 'url', 'id', 'icon', 'network', 'canonical', 'focal',
    'email', 'analyticsId'
  ]);
$$;

-- The readable text in `data`, joined with spaces. A translated value (an object whose keys are all locale codes) gives
-- the first of `locales` it has, or all of them when `locales` is null.
create function public.search_text(data jsonb, locales text[] default null)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  result text := '';
  part text;
  item jsonb;
  key text;
  code text;
begin
  case jsonb_typeof(data)
    when 'string' then
      return data #>> '{}';
    when 'array' then
      for item in select value from jsonb_array_elements(data) loop
        part := public.search_text(item, locales);
        if part <> '' then
          result := case when result = '' then part else result || ' ' || part end;
        end if;
      end loop;
    when 'object' then
      if data <> '{}'::jsonb and locales is not null
        and not exists (select 1 from jsonb_object_keys(data) k where k !~ '^[a-z]{2,3}(-[A-Z]{2})?$') then
        foreach code in array locales loop
          if data ? code then
            part := public.search_text(data -> code, null);
            if part <> '' then
              return part;
            end if;
          end if;
        end loop;
        return '';
      end if;
      for key, item in select k, v from jsonb_each(data) as t (k, v) loop
        if not public.search_skipped_key(key) then
          part := public.search_text(item, locales);
          if part <> '' then
            result := case when result = '' then part else result || ' ' || part end;
          end if;
        end if;
      end loop;
    else
      return '';
  end case;
  return result;
end;
$$;

-- An entry's data as a weighted search vector.
create function public.search_document(data jsonb)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    setweight(to_tsvector('pg_catalog.english', public.search_text(data -> 'title') || ' ' || public.search_text(data -> 'name')), 'A')
    || setweight(to_tsvector('pg_catalog.english', public.search_text(data -> 'seo')), 'B')
    || setweight(to_tsvector('pg_catalog.english', public.search_text(data - array['title', 'name', 'seo'])), 'C');
$$;

revoke execute on function public.search_skipped_key(text) from public, anon;
revoke execute on function public.search_text(jsonb, text[]) from public, anon;
revoke execute on function public.search_document(jsonb) from public, anon;

-- ---------------------------------------------------------------------------
-- Published content
-- ---------------------------------------------------------------------------
alter table public.published_content
  add column search tsvector not null generated always as (public.search_document(data)) stored;

create index published_content_search_idx on public.published_content using gin (search);

-- ---------------------------------------------------------------------------
-- Drafts: one row per entry for its current version, kept by triggers whenever it is saved.
-- ---------------------------------------------------------------------------
create table public.entry_search (
  entry_id uuid primary key,
  space_id uuid not null references public.spaces (id) on delete cascade,
  environment_id uuid not null,
  -- As lists show it: the current version's title (or name) in the default locale, else the slug.
  title text not null,
  search tsvector not null,
  updated_at timestamptz not null default now(),
  foreign key (entry_id, space_id) references public.entries (id, space_id) on delete cascade
);

create index entry_search_search_idx on public.entry_search using gin (search);
create index entry_search_space_id_idx on public.entry_search (space_id);
create index entry_search_environment_id_idx on public.entry_search (environment_id);

-- Writes the entry's search row from its current version. Security definer: the row follows a save the caller was
-- allowed to make, and no client role may write the table itself.
create function public.refresh_entry_search(entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.entry_search as s (entry_id, space_id, environment_id, title, search, updated_at)
  select
    e.id,
    e.space_id,
    e.environment_id,
    coalesce(
      nullif(btrim(public.search_text(v.data -> 'title', array[l.code])), ''),
      nullif(btrim(public.search_text(v.data -> 'name', array[l.code])), ''),
      e.slug
    ),
    public.search_document(v.data) || setweight(to_tsvector('pg_catalog.english', replace(e.slug, '-', ' ')), 'B'),
    now()
  from public.entries e
  join public.entry_versions v on v.id = e.current_version_id
  left join public.space_locales l on l.space_id = e.space_id and l.is_default
  where e.id = entry
  on conflict (entry_id) do update
    set title = excluded.title, search = excluded.search, updated_at = excluded.updated_at;
end;
$$;

create function public.entries_refresh_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_version_id is not null then
    perform public.refresh_entry_search(new.id);
  end if;
  return null;
end;
$$;

create function public.entry_versions_refresh_search()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Autosave overwrites the current version's data (0006).
  perform public.refresh_entry_search(e.id) from public.entries e where e.current_version_id = new.id;
  return null;
end;
$$;

revoke execute on function public.refresh_entry_search(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.entries_refresh_search() from public, anon, authenticated;
revoke execute on function public.entry_versions_refresh_search() from public, anon, authenticated;

create trigger entries_refresh_search
  after insert or update of current_version_id, slug on public.entries
  for each row execute function public.entries_refresh_search();

create trigger entry_versions_refresh_search
  after update of data on public.entry_versions
  for each row execute function public.entry_versions_refresh_search();

alter table public.entry_search enable row level security;

create policy "entry search: members and agency staff read" on public.entry_search
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

revoke all on table public.entry_search from public, anon, authenticated, service_role;
grant select on table public.entry_search to authenticated;

-- Entries that exist already.
select public.refresh_entry_search(e.id) from public.entries e where e.current_version_id is not null;

-- ---------------------------------------------------------------------------
-- Media: title and alt text, then the file name and tags.
-- ---------------------------------------------------------------------------
create function public.search_words(words text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(string_agg(w, ' '), '') from unnest(words) as t (w);
$$;

revoke execute on function public.search_words(text[]) from public, anon;

alter table public.assets
  add column search tsvector not null generated always as (
    setweight(to_tsvector('pg_catalog.english', coalesce(title, '') || ' ' || coalesce(alt, '')), 'A')
    || setweight(
      to_tsvector('pg_catalog.english', regexp_replace(filename, '[._-]+', ' ', 'g') || ' ' || public.search_words(tags)),
      'B'
    )
  ) stored;

create index assets_search_idx on public.assets using gin (search);

-- As in 0007, leaving out `search`: a BEFORE trigger sees generated columns before they are computed, so comparing it
-- would refuse authors the description changes they may make.
create or replace function public.assets_guard()
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
  elsif (to_jsonb(new) - '{alt,title,tags,folder,focal_x,focal_y,updated_at,search}'::text[])
    <> (to_jsonb(old) - '{alt,title,tags,folder,focal_x,focal_y,updated_at,search}'::text[]) then
    raise exception 'only editors can replace files or use the bin' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
