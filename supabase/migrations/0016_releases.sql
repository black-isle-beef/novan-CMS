-- 0016 Releases (docs/build/17-scheduling-releases-webhooks.md): pages that go live together. A release names a version
-- of each page; publishing it publishes them all in one transaction (or none, if one cannot be), now or at a set time
-- through scheduled_actions (0015). The CDN purge jobs are sent in that transaction, so they run once it commits.
--
-- status: draft -> scheduled -> published | failed; scheduled -> draft (cancelled); failed is a draft that says why.

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  -- Pages belong to an environment, so does a release.
  environment_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  -- When it is scheduled to go live (its waiting scheduled action's run_at), UTC.
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'failed')),
  -- Why the scheduled publish failed, in words.
  error text check (length(error) <= 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  foreign key (environment_id, space_id) references public.environments (id, space_id) on delete cascade,
  unique (id, space_id),
  unique (id, environment_id),
  check ((status = 'scheduled') = (scheduled_at is not null)),
  check ((status = 'published') = (published_at is not null)),
  check (status = 'failed' or error is null)
);

create index releases_space_id_idx on public.releases (space_id, created_at desc);
create index releases_environment_id_idx on public.releases (environment_id, space_id);
create index releases_created_by_idx on public.releases (created_by);
create index releases_published_by_idx on public.releases (published_by);

-- The version of each page the release publishes: one per page.
create table public.release_items (
  release_id uuid not null,
  space_id uuid not null,
  environment_id uuid not null,
  entry_id uuid not null,
  version_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (release_id, entry_id),
  foreign key (release_id, space_id) references public.releases (id, space_id) on delete cascade,
  foreign key (release_id, environment_id) references public.releases (id, environment_id) on delete cascade,
  foreign key (entry_id, environment_id) references public.entries (id, environment_id) on delete cascade,
  foreign key (version_id, entry_id) references public.entry_versions (id, entry_id) on delete cascade
);

create index release_items_space_id_idx on public.release_items (space_id);
create index release_items_entry_id_idx on public.release_items (entry_id, environment_id);
create index release_items_version_id_idx on public.release_items (version_id, entry_id);
create index release_items_release_env_idx on public.release_items (release_id, environment_id);

-- Scheduled actions can now name a release; one waiting publish per release.
alter table public.scheduled_actions
  add foreign key (release_id, space_id) references public.releases (id, space_id) on delete cascade;
create unique index scheduled_actions_waiting_release_idx on public.scheduled_actions (release_id) where status = 'scheduled';
create index scheduled_actions_release_id_idx on public.scheduled_actions (release_id, space_id);

-- People create releases as themselves and cannot record a publish or failure on them except by publishing (the
-- entries guard, 0011, decides whether they may publish each page). A published release no longer changes.
create function public.releases_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is distinct from (select auth.uid()) or new.status <> 'draft' or new.error is not null
      or new.published_at is not null or new.published_by is not null then
      raise exception 'a release starts as a draft, made by the person making it' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if old.status = 'published' then
    raise exception 'a published release cannot change' using errcode = 'check_violation';
  end if;
  if new.id <> old.id or new.space_id <> old.space_id or new.environment_id <> old.environment_id
    or new.created_by is distinct from old.created_by or new.created_at <> old.created_at
    or (new.status = 'failed' and old.status <> 'failed')
    or (new.error is not null and new.error is distinct from old.error)
    or (new.status = 'published' and new.published_by is distinct from (select auth.uid())) then
    raise exception 'this change to a release is not allowed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.releases_guard() from public, anon, authenticated;

create trigger releases_guard
  before insert or update on public.releases
  for each row execute function public.releases_guard();

-- The pages of a published release stay as they were published.
create function public.release_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent uuid := case when tg_op = 'DELETE' then old.release_id else new.release_id end;
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if (select status from public.releases where id = parent) = 'published' then
    raise exception 'a published release cannot change' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.release_id <> old.release_id or new.entry_id <> old.entry_id) then
    raise exception 'only the version of a release''s page can change' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.release_items_guard() from public, anon, authenticated;

create trigger release_items_guard
  before insert or update or delete on public.release_items
  for each row execute function public.release_items_guard();

alter table public.releases enable row level security;
alter table public.release_items enable row level security;

create policy "releases: members and agency staff read" on public.releases
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));
create policy "releases: editors and up create" on public.releases
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));
create policy "releases: editors and up change" on public.releases
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));
create policy "releases: editors and up delete unpublished ones" on public.releases
  for delete to authenticated
  using (status <> 'published' and ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}'))));

create policy "release items: members and agency staff read" on public.release_items
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));
create policy "release items: editors and up add" on public.release_items
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));
create policy "release items: editors and up change" on public.release_items
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));
create policy "release items: editors and up remove" on public.release_items
  for delete to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

revoke all on public.releases, public.release_items from anon, authenticated, service_role;
grant select, insert, update, delete on public.releases, public.release_items to authenticated;

-- A release's scheduled publish is scheduled by whoever may publish its pages: with approval on, space admins.
-- (The scheduled_actions guard in 0015 already checks this for `publish`, whatever it names.)
