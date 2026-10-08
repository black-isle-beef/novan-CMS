-- 0011 Workflow and publishing (docs/build/13-workflow-publishing.md): optional approval per space, review
-- requests, and the database's half of the publishing rules (the API's state machine, libs/api/content/src/lib/
-- workflow.ts, is the other half and decides first).

-- ---------------------------------------------------------------------------
-- Approval per space: off by default. When on, only space admins and agency staff publish; authors, editors and
-- developers submit pages for review.
-- ---------------------------------------------------------------------------
alter table public.spaces add column require_approval boolean not null default false;

-- Whether the space needs approval to publish. Security definer, so the entries guard can read it for any caller.
create function public.space_requires_approval(space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select require_approval from public.spaces where id = space), false);
$$;

revoke execute on function public.space_requires_approval(uuid) from public, anon;
grant execute on function public.space_requires_approval(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Review requests: one row per submission, closed by a decision. At most one open request per entry.
-- ---------------------------------------------------------------------------
create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  entry_id uuid not null,
  -- The version submitted.
  version_id uuid not null,
  message text check (length(message) <= 500),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  -- approved: published; changes_requested: back to draft with a comment; withdrawn: the page was changed
  -- (or taken off the site, archived or published) before anyone decided.
  decision text check (decision in ('approved', 'changes_requested', 'withdrawn')),
  comment text check (length(comment) <= 2000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  foreign key (entry_id, space_id) references public.entries (id, space_id) on delete cascade,
  foreign key (version_id, entry_id) references public.entry_versions (id, entry_id) on delete cascade,
  check ((decision is null) = (decided_at is null)),
  check (decision <> 'changes_requested' or length(btrim(comment)) > 0)
);

create unique index review_requests_open_idx on public.review_requests (entry_id) where decision is null;
create index review_requests_space_open_idx on public.review_requests (space_id, requested_at) where decision is null;
create index review_requests_entry_id_idx on public.review_requests (entry_id, requested_at desc);
create index review_requests_version_id_idx on public.review_requests (version_id);
create index review_requests_requested_by_idx on public.review_requests (requested_by);
create index review_requests_decided_by_idx on public.review_requests (decided_by);

-- Who asked and what they asked for stay fixed; a request is decided once. Approving or asking for changes needs
-- a space admin or agency staff; anyone who may edit the page may withdraw a request by changing the page.
create function public.review_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.requested_by is distinct from (select auth.uid()) or new.decision is not null then
      raise exception 'a review request is made open, by the person asking' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.space_id <> old.space_id or new.entry_id <> old.entry_id
    or new.version_id <> old.version_id or new.message is distinct from old.message
    or new.requested_by is distinct from old.requested_by or new.requested_at <> old.requested_at then
    raise exception 'a review request cannot be changed, only decided' using errcode = 'check_violation';
  end if;
  if old.decision is not null then
    raise exception 'this review request has been decided' using errcode = 'check_violation';
  end if;
  if new.decided_by is distinct from (select auth.uid()) then
    raise exception 'a decision is recorded as the person deciding' using errcode = 'insufficient_privilege';
  end if;
  if new.decision in ('approved', 'changes_requested')
    and not ((select public.is_agency_staff()) or (select public.has_space_role(new.space_id, '{admin}'))) then
    raise exception 'only space admins and agency staff review pages' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.review_requests_guard() from public, anon, authenticated;

create trigger review_requests_guard
  before insert or update on public.review_requests
  for each row execute function public.review_requests_guard();

alter table public.review_requests enable row level security;

create policy "review requests: members and agency staff read" on public.review_requests
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "review requests: authors and up ask" on public.review_requests
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')));

create policy "review requests: authors and up decide or withdraw" on public.review_requests
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor,author}')));

grant select, insert, update on public.review_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Entries: authors may send a page for review and take it back; with approval on, publishing needs a space admin
-- or agency staff. Everything else is as in 0006.
-- ---------------------------------------------------------------------------
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
    or new.content_type_id <> old.content_type_id or new.locale <> old.locale
    or new.created_by is distinct from old.created_by and new.created_by is not null
    or new.created_at <> old.created_at
  ) then
    raise exception 'an entry''s space, environment, type, locale and creator cannot change'
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
