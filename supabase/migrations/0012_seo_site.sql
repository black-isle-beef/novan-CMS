-- 0012 SEO and site features (docs/build/14-seo-site-features.md): redirects, and the addresses visitors found no
-- page at.
--
--   table            select            insert                 update                 delete
--   redirects        members, staff    editors and up (1)     editors and up (1)     editors and up
--   not_found_hits   members, staff    the API (2)            the API (2)            nobody
--
-- "Editors and up" is admin, developer and editor, as for publishing (0006). Agency staff count only at AAL2.
--
-- (1) The database also writes redirects itself: when a published page's address changes (a new slug published,
--     the page moved, or a folder above it renamed or moved), its old address redirects to the new one with a 301.
-- (2) Client sites report misses through the Delivery API (`POST /v1/delivery/not-found`), which records them with
--     `record_not_found` as the service role: one row per address and day, counting the visits.

-- ---------------------------------------------------------------------------
-- Site paths. Published content stores the top-level home page as `/home`; the site shows it at `/`.
-- ---------------------------------------------------------------------------
create function public.site_path(full_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when full_path = '/home' then '/' else full_path end;
$$;

-- ---------------------------------------------------------------------------
-- redirects
-- ---------------------------------------------------------------------------
create table public.redirects (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  -- An address on the site: a path without a query or fragment, and no trailing slash (but `/` itself).
  from_path text not null check (
    from_path ~ '^/[^?#[:space:]]*$' and (from_path = '/' or right(from_path, 1) <> '/') and length(from_path) <= 1024
  ),
  -- Another address on the site (it may carry a query or fragment), or a whole http(s) URL elsewhere.
  to_path text not null check ((to_path ~ '^/[^[:space:]]*$' or to_path ~* '^https?://[^/[:space:]]+\S*$') and length(to_path) <= 2048),
  status smallint not null default 301 check (status in (301, 302)),
  -- Who added it; null for a redirect the database made when a page's address changed.
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, from_path),
  check (from_path <> to_path)
);

create index redirects_to_path_idx on public.redirects (space_id, to_path);
create index redirects_created_by_idx on public.redirects (created_by);

create trigger redirects_set_updated_at
  before update on public.redirects
  for each row execute function public.set_updated_at();

-- Members cannot change who made a redirect, or move it to another space.
create function public.redirects_guard()
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
      raise exception 'a redirect is added as the person adding it' using errcode = 'insufficient_privilege';
    end if;
  elsif new.space_id <> old.space_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'a redirect''s space and author cannot change' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.redirects_guard() from public, anon, authenticated;

create trigger redirects_guard
  before insert or update on public.redirects
  for each row execute function public.redirects_guard();

alter table public.redirects enable row level security;

create policy "redirects: members and agency staff read" on public.redirects
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "redirects: editors and up add" on public.redirects
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

create policy "redirects: editors and up change" on public.redirects
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

create policy "redirects: editors and up delete" on public.redirects
  for delete to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

grant select, insert, update, delete on public.redirects to authenticated;
revoke all on table public.redirects from anon;

-- ---------------------------------------------------------------------------
-- Automatic redirects. Runs after published content is written: by whoever published or moved the page (whose
-- rights RLS on published_content has checked), or by the folder trigger (0006). Security definer, so it may write
-- redirects for them. Only pages of the main environment, the one sites are served from.
-- ---------------------------------------------------------------------------
create function public.published_content_redirects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_path text := public.site_path(new.full_path);
  old_path text;
begin
  if not exists (select 1 from public.environments e where e.id = new.environment_id and e.is_main)
    or not exists (
      select 1 from public.content_types t
      where t.environment_id = new.environment_id and t.api_id = new.content_type_api_id and t.kind = 'page'
    ) then
    return null;
  end if;

  -- A page lives here now: no redirect may hide it.
  delete from public.redirects where space_id = new.space_id and from_path = new_path;

  if tg_op = 'UPDATE' and old.full_path <> new.full_path
    -- Another page (another locale) still answers at the old address.
    and not exists (
      select 1 from public.published_content p
      where p.environment_id = new.environment_id and p.full_path = old.full_path
    ) then
    old_path := public.site_path(old.full_path);
    -- Redirects to the old address now go straight to the new one, rather than through a chain.
    update public.redirects set to_path = new_path where space_id = new.space_id and to_path = old_path;
    insert into public.redirects (space_id, from_path, to_path, status)
    values (new.space_id, old_path, new_path, 301)
    on conflict (space_id, from_path) do update set to_path = excluded.to_path, status = 301;
  end if;
  return null;
end;
$$;

revoke execute on function public.published_content_redirects() from public, anon, authenticated;

create trigger published_content_redirects
  after insert or update of full_path on public.published_content
  for each row execute function public.published_content_redirects();

-- ---------------------------------------------------------------------------
-- not_found_hits: one row per address and day.
-- ---------------------------------------------------------------------------
create table public.not_found_hits (
  space_id uuid not null references public.spaces (id) on delete cascade,
  path text not null check (path ~ '^/[^?#[:space:]]*$' and length(path) <= 1024),
  -- The UTC day, set by record_not_found.
  day date not null,
  hits integer not null default 1 check (hits > 0),
  -- The page that linked to the address, when the browser said.
  last_referrer text check (length(last_referrer) <= 2048),
  last_seen_at timestamptz not null default now(),
  primary key (space_id, day, path)
);

create index not_found_hits_space_path_idx on public.not_found_hits (space_id, path);

alter table public.not_found_hits enable row level security;

create policy "not found hits: members and agency staff read" on public.not_found_hits
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

grant select on public.not_found_hits to authenticated;
revoke all on table public.not_found_hits from anon;
revoke insert, update, delete, truncate on table public.not_found_hits from authenticated;

-- At most this many different addresses are kept per space and day, so a crawler trying random addresses cannot
-- fill the table; visits to addresses already recorded still count.
create function public.record_not_found(space uuid, missed_path text, referrer text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  update public.not_found_hits
  set hits = hits + 1, last_seen_at = now(), last_referrer = coalesce(referrer, last_referrer)
  where space_id = space and day = today and path = missed_path;
  if found then
    return;
  end if;
  if (select count(*) from public.not_found_hits where space_id = space and day = today) >= 1000 then
    return;
  end if;
  insert into public.not_found_hits (space_id, path, day, last_referrer)
  values (space, missed_path, today, referrer)
  on conflict (space_id, day, path) do update
    set hits = public.not_found_hits.hits + 1, last_seen_at = now(),
        last_referrer = coalesce(excluded.last_referrer, public.not_found_hits.last_referrer);
end;
$$;

revoke execute on function public.record_not_found(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_not_found(uuid, text, text) to service_role;
