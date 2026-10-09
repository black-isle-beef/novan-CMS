-- 0013 Localisation (docs/build/16-localisation.md): the languages a space publishes in, and field-level translation.
--
--   table          select            insert / update / delete
--   space_locales  members, staff    space admins and developers, agency staff
--
-- A translated (`localised`) field stores one value per locale inside the version data, `{ "en-GB": ..., "fr-FR": ... }`;
-- every other field stores a plain value, shared by all locales. Only value fields are translated: a `group` or
-- `blocks` field holds structure every locale shares (the same blocks in the same order), and the fields inside it are
-- translated when they are marked. A page's slug is its address in every locale, so it is never translated.
--
-- Before this package an entry had a single `locale`; now one entry holds every locale, so `entries.locale`,
-- `published_content.locale` and `spaces.default_locale` (replaced by `space_locales.is_default`) are dropped. Existing
-- data is wrapped in each space's default locale, and the migration stops if unwrapping it would not give back exactly
-- what was there before.

-- ---------------------------------------------------------------------------
-- space_locales
-- ---------------------------------------------------------------------------
create table public.space_locales (
  space_id uuid not null references public.spaces (id) on delete cascade,
  -- A BCP 47 language with an optional region, e.g. `en-GB` or `fr`.
  code text not null check (code ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  name text not null check (length(trim(name)) > 0 and length(name) <= 60),
  -- Where a missing translation is read from instead; null for none. Never the locale itself, and never in a circle.
  fallback_code text,
  is_default boolean not null default false,
  -- The first part of the locale's addresses when the space uses locale prefixes (`/fr/about`); the default locale
  -- is served without one.
  path_prefix text not null check (path_prefix ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(path_prefix) <= 20),
  created_at timestamptz not null default now(),
  primary key (space_id, code),
  unique (space_id, path_prefix),
  foreign key (space_id, fallback_code) references public.space_locales (space_id, code) on delete set null (fallback_code),
  check (fallback_code is distinct from code),
  check (not is_default or fallback_code is null)
);

-- Exactly one default per space, no circular fallbacks. Checked at commit, so the default can move from one locale to
-- another in two statements.
create function public.space_locales_invariants()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  space uuid := coalesce(new.space_id, old.space_id);
begin
  if not exists (select 1 from public.spaces where id = space) then
    return null;
  end if;
  if (select count(*) from public.space_locales where space_id = space and is_default) <> 1 then
    raise exception 'a space has exactly one default locale' using errcode = 'check_violation';
  end if;
  if exists (
    with recursive chain (start, next, depth) as (
      select code, fallback_code, 1 from public.space_locales where space_id = space
      union all
      select c.start, l.fallback_code, c.depth + 1
      from chain c
      join public.space_locales l on l.space_id = space and l.code = c.next
      where c.depth <= 100
    )
    select 1 from chain where next = start
  ) then
    raise exception 'locales cannot fall back in a circle' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

revoke execute on function public.space_locales_invariants() from public, anon, authenticated;

create constraint trigger space_locales_invariants
  after insert or update or delete on public.space_locales
  deferrable initially deferred
  for each row execute function public.space_locales_invariants();

alter table public.space_locales enable row level security;

create policy "space locales: members and agency staff read" on public.space_locales
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "space locales: admins, developers and agency staff write" on public.space_locales
  for all to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));

grant select, insert, update, delete on public.space_locales to authenticated;
revoke all on table public.space_locales from anon;

-- Locales of spaces that exist already: their default locale, with a readable name for the common ones.
insert into public.space_locales (space_id, code, name, is_default, path_prefix)
select
  s.id,
  s.default_locale,
  case s.default_locale
    when 'en-GB' then 'English (UK)'
    when 'en-US' then 'English (US)'
    when 'en' then 'English'
    when 'fr-FR' then 'French (France)'
    when 'de-DE' then 'German (Germany)'
    when 'es-ES' then 'Spanish (Spain)'
    else s.default_locale
  end,
  true,
  lower(split_part(s.default_locale, '-', 1))
from public.spaces s;

-- New spaces start in British English (security definer, as handle_new_space in 0001).
create function public.handle_new_space_locale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.space_locales (space_id, code, name, is_default, path_prefix)
  values (new.id, 'en-GB', 'English (UK)', true, 'en');
  return new;
end;
$$;

revoke execute on function public.handle_new_space_locale() from public, anon, authenticated;

create trigger on_space_created_locale
  after insert on public.spaces
  for each row execute function public.handle_new_space_locale();

-- Whether the site serves each non-default locale under its prefix (`/fr/...`). A space setting, so the Delivery API
-- can give pages, links and alternates their addresses on the site.
alter table public.spaces add column locale_prefixes boolean not null default false;

-- ---------------------------------------------------------------------------
-- Content models: only value fields are translated, and never a page's slug.
-- ---------------------------------------------------------------------------
create function public.l10n_value_fields_only(fields jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := '[]'::jsonb;
  field jsonb;
begin
  if jsonb_typeof(fields) is distinct from 'array' then
    return fields;
  end if;
  for field in select f from jsonb_array_elements(fields) with ordinality as t (f, ord) order by ord loop
    if field ->> 'type' = 'group' then
      field := jsonb_set(field || '{"localised": false}', '{fields}', public.l10n_value_fields_only(field -> 'fields'));
    elsif field ->> 'type' = 'blocks' then
      field := field || '{"localised": false}';
    end if;
    result := result || jsonb_build_array(field);
  end loop;
  return result;
end;
$$;

update public.block_types set fields = public.l10n_value_fields_only(fields);

update public.content_types
set fields = coalesce((
  select jsonb_agg(case when f ->> 'apiId' = 'slug' then f || '{"localised": false}' else f end order by ord)
  from jsonb_array_elements(public.l10n_value_fields_only(fields)) with ordinality as t (f, ord)
), '[]'::jsonb);

-- ---------------------------------------------------------------------------
-- Entry data: each translated value becomes `{ "<default locale>": value }`.
-- ---------------------------------------------------------------------------

-- `data` with every translated value wrapped in (`wrap`) or taken out of (`not wrap`) `locale`, following the field
-- definitions through groups and blocks (`blocks` maps a block type's api id to its fields).
create function public.l10n_convert(fields jsonb, data jsonb, locale text, blocks jsonb, wrap boolean)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  field jsonb;
  key text;
  value jsonb;
begin
  if jsonb_typeof(data) is distinct from 'object' or jsonb_typeof(fields) is distinct from 'array' then
    return data;
  end if;
  for field in select f from jsonb_array_elements(fields) with ordinality as t (f, ord) order by ord loop
    key := field ->> 'apiId';
    if key is null or not data ? key or jsonb_typeof(data -> key) = 'null' then
      continue;
    end if;
    value := data -> key;
    if field ->> 'type' = 'group' then
      if jsonb_typeof(value) = 'array' then
        select coalesce(jsonb_agg(public.l10n_convert(field -> 'fields', item, locale, blocks, wrap) order by ord), '[]'::jsonb)
        into value
        from jsonb_array_elements(value) with ordinality as t (item, ord);
      else
        value := public.l10n_convert(field -> 'fields', value, locale, blocks, wrap);
      end if;
    elsif field ->> 'type' = 'blocks' then
      value := public.l10n_convert_blocks(value, locale, blocks, wrap);
    elsif coalesce((field ->> 'localised')::boolean, false) then
      value := case when wrap then jsonb_build_object(locale, value) else value -> locale end;
    end if;
    data := jsonb_set(data, array[key], value);
  end loop;
  return data;
end;
$$;

create function public.l10n_convert_blocks(nodes jsonb, locale text, blocks jsonb, wrap boolean)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := '[]'::jsonb;
  node jsonb;
begin
  if jsonb_typeof(nodes) is distinct from 'array' then
    return nodes;
  end if;
  for node in select n from jsonb_array_elements(nodes) with ordinality as t (n, ord) order by ord loop
    if jsonb_typeof(node) = 'object' then
      if blocks ? (node ->> '_block') then
        node := public.l10n_convert(blocks -> (node ->> '_block'), node, locale, blocks, wrap);
      end if;
      if node ? 'children' then
        node := jsonb_set(node, '{children}', public.l10n_convert_blocks(node -> 'children', locale, blocks, wrap));
      end if;
    end if;
    result := result || jsonb_build_array(node);
  end loop;
  return result;
end;
$$;

-- Each environment's block types, and each space's default locale, as the conversion needs them.
create temporary table l10n_blocks on commit drop as
select environment_id, jsonb_object_agg(api_id, fields) as blocks
from public.block_types
group by environment_id;

create temporary table l10n_versions on commit drop as
select v.id, v.data, ct.fields, sl.code as locale, coalesce(b.blocks, '{}'::jsonb) as blocks
from public.entry_versions v
join public.entries e on e.id = v.entry_id
join public.content_types ct on ct.id = e.content_type_id
join public.space_locales sl on sl.space_id = e.space_id and sl.is_default
left join l10n_blocks b on b.environment_id = e.environment_id;

create temporary table l10n_published on commit drop as
select p.entry_id, p.data, ct.fields, sl.code as locale, coalesce(b.blocks, '{}'::jsonb) as blocks
from public.published_content p
join public.content_types ct on ct.environment_id = p.environment_id and ct.api_id = p.content_type_api_id
join public.space_locales sl on sl.space_id = p.space_id and sl.is_default
left join l10n_blocks b on b.environment_id = p.environment_id;

-- Nothing is lost: unwrapping the wrapped data gives back exactly the data as it was.
do $$
declare
  lost bigint;
begin
  select count(*) into lost from (
    select data, fields, locale, blocks from l10n_versions
    union all
    select data, fields, locale, blocks from l10n_published
  ) rows
  where public.l10n_convert(fields, public.l10n_convert(fields, data, locale, blocks, true), locale, blocks, false) <> data;
  if lost > 0 then
    raise exception 'localisation would change % rows of entry data; nothing was migrated', lost;
  end if;
end;
$$;

-- Versions are immutable (0006): only this migration rewrites them.
alter table public.entry_versions disable trigger entry_versions_guard;
update public.entry_versions v
set data = public.l10n_convert(l.fields, l.data, l.locale, l.blocks, true)
from l10n_versions l
where l.id = v.id;
alter table public.entry_versions enable trigger entry_versions_guard;

update public.published_content p
set data = public.l10n_convert(l.fields, l.data, l.locale, l.blocks, true)
from l10n_published l
where l.entry_id = p.entry_id;

drop function public.l10n_convert(jsonb, jsonb, text, jsonb, boolean);
drop function public.l10n_convert_blocks(jsonb, text, jsonb, boolean);
drop function public.l10n_value_fields_only(jsonb);

-- ---------------------------------------------------------------------------
-- One entry holds every locale.
-- ---------------------------------------------------------------------------
drop index public.entries_address_idx;
-- One live entry per address; the root folder (null) counts as one folder.
create unique index entries_address_idx on public.entries (environment_id, folder_id, slug)
  nulls not distinct where deleted_at is null;
alter table public.entries drop column locale;

drop index public.published_content_address_idx;
create unique index published_content_address_idx on public.published_content (environment_id, full_path);
alter table public.published_content drop column locale;

alter table public.spaces drop column default_locale;

-- As in 0011, without the locale.
create or replace function public.entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  publishing boolean;
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.space_id <> old.space_id or new.environment_id <> old.environment_id
    or new.content_type_id <> old.content_type_id
    or new.created_by is distinct from old.created_by and new.created_by is not null
    or new.created_at <> old.created_at
  ) then
    raise exception 'an entry''s space, environment, type and creator cannot change'
      using errcode = 'check_violation';
  end if;

  if current_user <> 'authenticated' or (select public.is_agency_staff()) then
    return new;
  end if;

  -- A new published version goes live.
  publishing := new.published_version_id is not null
    and (tg_op = 'INSERT' or new.published_version_id is distinct from old.published_version_id);
  if publishing and (select public.space_requires_approval(new.space_id))
    and not (select public.has_space_role(new.space_id, '{admin}')) then
    raise exception 'this space needs approval: only space admins publish' using errcode = 'insufficient_privilege';
  end if;

  if (select public.has_space_role(new.space_id, '{admin,developer,editor}')) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.published_version_id is not null or new.published_at is not null
      or new.deleted_at is not null then
      raise exception 'only editors can create published or deleted entries' using errcode = 'insufficient_privilege';
    end if;
  elsif new.published_version_id is distinct from old.published_version_id
    or new.published_at is distinct from old.published_at
    or new.deleted_at is distinct from old.deleted_at
    or (new.status is distinct from old.status
        -- To review and back; a live page returns to `published` (the check constraint needs its published version).
        and not (old.status, new.status) in (
          ('draft', 'in_review'), ('in_review', 'draft'), ('published', 'in_review'), ('in_review', 'published')
        )) then
    raise exception 'only editors can publish, unpublish, delete or restore entries' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
