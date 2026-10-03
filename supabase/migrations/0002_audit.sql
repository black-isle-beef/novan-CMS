-- 0002 Audit: append-only log of changes within a space.
--
-- Rows are written by the API (service role) and never changed afterwards:
-- update, delete and truncate are revoked from every API-facing role, and a
-- trigger rejects updates and deletes from anyone else (including the owner),
-- except the cascade when a whole space is deleted.

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  diff jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_space_id_created_at_idx on public.audit_events (space_id, created_at desc);
create index audit_events_actor_id_idx on public.audit_events (actor_id);

revoke update, delete, truncate on table public.audit_events from public, anon, authenticated, service_role;

create function public.prevent_audit_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Deleting a space cascades to its audit trail; by then the space row is gone.
  if tg_op = 'DELETE' and not exists (select 1 from public.spaces where id = old.space_id) then
    return old;
  end if;

  raise exception 'audit_events is append-only'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.prevent_audit_event_change() from public, anon, authenticated;

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function public.prevent_audit_event_change();

alter table public.audit_events enable row level security;
