-- 0015 Scheduled publishing (docs/build/17-scheduling-releases-webhooks.md): publish or unpublish a page at a set
-- time. A pg_cron job runs every minute and sends each action that has come due to the `publish` queue (0014); the
-- API's worker carries it out as the person who scheduled it, with their role at that moment.
--
-- status: scheduled -> queued (sent to the worker) -> done | failed; scheduled -> cancelled.

create extension if not exists pg_cron;

create table public.scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  -- What to publish or unpublish: a page, or a release (whose table and foreign key come with releases).
  entry_id uuid,
  release_id uuid,
  action text not null check (action in ('publish', 'unpublish')),
  -- UTC, like every stored time; the admin shows it in UK time.
  run_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'queued', 'done', 'failed', 'cancelled')),
  -- Why it failed, in words for the person who scheduled it.
  error text check (length(error) <= 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (entry_id, space_id) references public.entries (id, space_id) on delete cascade,
  check (num_nonnulls(entry_id, release_id) = 1),
  check ((status in ('done', 'failed', 'cancelled')) = (finished_at is not null)),
  check (status = 'failed' or error is null)
);

-- One waiting publish and one waiting unpublish per page; to change the time, cancel and schedule again.
create unique index scheduled_actions_waiting_idx on public.scheduled_actions (entry_id, action) where status = 'scheduled';
create index scheduled_actions_due_idx on public.scheduled_actions (run_at) where status = 'scheduled';
create index scheduled_actions_space_id_idx on public.scheduled_actions (space_id, run_at);
create index scheduled_actions_entry_id_idx on public.scheduled_actions (entry_id, created_at desc);
create index scheduled_actions_created_by_idx on public.scheduled_actions (created_by);

-- People schedule actions as themselves, for the future, and may only cancel them afterwards; the worker (the owner's
-- connection) records the outcome. With approval on, only space admins and agency staff schedule publishing, as only
-- they may publish (0011).
create function public.scheduled_actions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.created_by is distinct from (select auth.uid()) or new.status <> 'scheduled'
      or new.error is not null or new.finished_at is not null then
      raise exception 'an action is scheduled waiting, by the person scheduling it' using errcode = 'insufficient_privilege';
    end if;
    if new.run_at <= now() then
      raise exception 'an action is scheduled for the future' using errcode = 'check_violation';
    end if;
    if new.action = 'publish' and (select public.space_requires_approval(new.space_id))
      and not ((select public.is_agency_staff()) or (select public.has_space_role(new.space_id, '{admin}'))) then
      raise exception 'this space needs approval: only space admins schedule publishing' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.space_id <> old.space_id or new.entry_id is distinct from old.entry_id
    or new.release_id is distinct from old.release_id or new.action <> old.action or new.run_at <> old.run_at
    or new.error is distinct from old.error or new.created_by is distinct from old.created_by
    or new.created_at <> old.created_at
    or not (old.status = 'scheduled' and new.status = 'cancelled') then
    raise exception 'a scheduled action can only be cancelled, while it waits' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.scheduled_actions_guard() from public, anon, authenticated;

create trigger scheduled_actions_guard
  before insert or update on public.scheduled_actions
  for each row execute function public.scheduled_actions_guard();

alter table public.scheduled_actions enable row level security;

create policy "scheduled actions: members and agency staff read" on public.scheduled_actions
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "scheduled actions: editors and up schedule" on public.scheduled_actions
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

create policy "scheduled actions: editors and up cancel" on public.scheduled_actions
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer,editor}')));

revoke all on public.scheduled_actions from anon, authenticated, service_role;
grant select, insert, update on public.scheduled_actions to authenticated;

-- ---------------------------------------------------------------------------
-- Every minute: mark due actions queued and send each to the worker, in one transaction. Skipping locked rows lets a
-- slow run overlap the next without sending an action twice.
-- ---------------------------------------------------------------------------
create function public.enqueue_due_scheduled_actions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due record;
  sent integer := 0;
begin
  for due in
    update public.scheduled_actions a
    set status = 'queued'
    where a.id in (
      select s.id from public.scheduled_actions s
      where s.status = 'scheduled' and s.run_at <= now()
      order by s.run_at
      limit 1000
      for update skip locked
    )
    returning a.id, a.space_id
  loop
    perform pgmq.send('publish', jsonb_build_object('type', 'scheduled-action', 'actionId', due.id, 'spaceId', due.space_id));
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke execute on function public.enqueue_due_scheduled_actions() from public, anon, authenticated, service_role;

select cron.schedule('enqueue-scheduled-actions', '* * * * *', 'select public.enqueue_due_scheduled_actions()');
