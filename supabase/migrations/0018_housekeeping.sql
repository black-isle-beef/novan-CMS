-- 0018 Housekeeping (docs/build/17-scheduling-releases-webhooks.md): every night pg_cron puts housekeeping jobs on the
-- `housekeeping` queue (0014) and the API's worker runs them:
--   purge-bin        pages and entries in the bin for 30 days are deleted for good, with their versions (audited)
--   purge-assets     files in the bin for 30 days are deleted, from Storage too (the worker does that part)
--   prune-autosaves  autosave versions older than 90 days are deleted, except ones that are current, published, or
--                    named by a review request or a release; versions saved by a person (named or not) are kept
-- Signed preview tokens (package 12) are not stored: each carries its own expiry (15 minutes) in its signature, so there
-- is nothing to expire.

-- ---------------------------------------------------------------------------
-- Entry versions stay immutable (0006), except that pruning may delete old, unreferenced autosaves. Only the owner's
-- connection can delete versions at all (no client role has DELETE), and only inside prune_autosave_versions(), which
-- sets the flag below for its own transaction.
-- ---------------------------------------------------------------------------
create or replace function public.entry_versions_guard()
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
    if current_setting('novan.pruning_autosaves', true) = 'on' and old.autosave
      and not exists (
        select 1 from public.entries e
        where e.id = old.entry_id and (e.current_version_id = old.id or e.published_version_id = old.id)
      ) then
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

-- Deletes up to `batch` autosave versions older than `keep`; returns how many. Run again until it returns less than
-- `batch`.
create function public.prune_autosave_versions(keep interval default interval '90 days', batch integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  pruned integer;
begin
  perform set_config('novan.pruning_autosaves', 'on', true);
  delete from public.entry_versions v
  where v.id in (
    select c.id from public.entry_versions c
    where c.autosave and c.message is null and c.created_at < now() - keep
      and not exists (
        select 1 from public.entries e
        where e.id = c.entry_id and (e.current_version_id = c.id or e.published_version_id = c.id)
      )
      and not exists (select 1 from public.review_requests r where r.version_id = c.id)
      and not exists (select 1 from public.release_items i where i.version_id = c.id)
    order by c.created_at
    limit batch
  );
  get diagnostics pruned = row_count;
  perform set_config('novan.pruning_autosaves', 'off', true);
  return pruned;
end;
$$;

-- Deletes up to `batch` entries that have been in the bin longer than `older_than`, with everything that hangs off
-- them, and audits each; returns how many.
create function public.purge_binned_entries(older_than interval default interval '30 days', batch integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  with gone as (
    delete from public.entries e
    where e.id in (
      select b.id from public.entries b
      where b.deleted_at is not null and b.deleted_at < now() - older_than
      order by b.deleted_at
      limit batch
    )
    returning e.id, e.space_id, e.slug, e.deleted_at
  )
  insert into public.audit_events (space_id, action, target_type, target_id, diff)
  select g.space_id, 'entry.purged', 'entry', g.id::text, jsonb_build_object('slug', g.slug, 'deletedAt', g.deleted_at)
  from gone g;
  get diagnostics purged = row_count;
  return purged;
end;
$$;

revoke execute on function public.prune_autosave_versions(interval, integer) from public, anon, authenticated, service_role;
revoke execute on function public.purge_binned_entries(interval, integer) from public, anon, authenticated, service_role;

-- Every night at 03:30 UTC (quiet in the UK all year).
select cron.schedule(
  'housekeeping',
  '30 3 * * *',
  $$
    select pgmq.send('housekeeping', '{"type": "purge-bin"}'::jsonb);
    select pgmq.send('housekeeping', '{"type": "purge-assets"}'::jsonb);
    select pgmq.send('housekeeping', '{"type": "prune-autosaves"}'::jsonb);
  $$
);
