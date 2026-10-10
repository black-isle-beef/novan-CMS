-- 0017 Webhooks (docs/build/17-scheduling-releases-webhooks.md): a space tells other systems when its content changes.
-- Each change becomes a `dispatch` job on the `webhooks` queue (0014), sent in the changing transaction; the worker
-- turns it into one delivery per subscribed webhook and POSTs each, signed with the webhook's secret (HMAC-SHA256 over
-- the timestamp and body, in `X-Novan-Signature`), retrying failures with back-off.
--
-- Space admins, developers and agency staff manage webhooks, as API tokens (0008). The secret is shown once, when it
-- is made; no client role can read it back (column privileges), only the API's own connection, to sign.

create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  url text not null check (url ~ '^https?://[^\s]+$' and length(url) <= 2000),
  -- Event types it receives, e.g. {entry.published}.
  events text[] not null check (cardinality(events) > 0),
  secret text not null check (length(secret) >= 32),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, space_id)
);

create index webhooks_space_id_idx on public.webhooks (space_id) where active;
create index webhooks_created_by_idx on public.webhooks (created_by);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null,
  space_id uuid not null,
  -- The change it reports, the same for every webhook it went to (receivers can ignore one they have seen).
  event_id uuid not null,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  response_code integer,
  attempt integer not null default 0 check (attempt >= 0),
  error text check (length(error) <= 2000),
  -- A person's resend of an earlier delivery: the same event, sent again.
  resend_of uuid references public.webhook_deliveries (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (webhook_id, space_id) references public.webhooks (id, space_id) on delete cascade
);

-- A change is delivered to a webhook once, however often its dispatch runs; resends come on top.
create unique index webhook_deliveries_event_idx on public.webhook_deliveries (webhook_id, event_id) where resend_of is null;
create index webhook_deliveries_resend_of_idx on public.webhook_deliveries (resend_of);
create index webhook_deliveries_webhook_id_idx on public.webhook_deliveries (webhook_id, created_at desc);
create index webhook_deliveries_space_id_idx on public.webhook_deliveries (space_id, created_at desc);
create index webhook_deliveries_webhook_space_idx on public.webhook_deliveries (webhook_id, space_id);

create trigger webhooks_set_updated_at
  before update on public.webhooks
  for each row execute function public.set_updated_at();

create trigger webhook_deliveries_set_updated_at
  before update on public.webhook_deliveries
  for each row execute function public.set_updated_at();

alter table public.webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;

create policy "webhooks: admins, developers and agency staff read" on public.webhooks
  for select to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));
create policy "webhooks: admins, developers and agency staff create" on public.webhooks
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));
create policy "webhooks: admins, developers and agency staff change" on public.webhooks
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));
create policy "webhooks: admins, developers and agency staff delete" on public.webhooks
  for delete to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));

-- Deliveries are written by the worker; people read them and resend one (a new, pending delivery).
create policy "webhook deliveries: admins, developers and agency staff read" on public.webhook_deliveries
  for select to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')));
create policy "webhook deliveries: admins, developers and agency staff resend" on public.webhook_deliveries
  for insert to authenticated
  with check (
    status = 'pending' and attempt = 0 and response_code is null and error is null
    and ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,developer}')))
  );

revoke all on public.webhooks, public.webhook_deliveries from anon, authenticated, service_role;
-- Every column but the secret can be read; the secret can be written (made or rotated), never read.
grant select (id, space_id, name, url, events, active, created_by, created_at, updated_at) on public.webhooks to authenticated;
grant insert on public.webhooks to authenticated;
grant update (name, url, events, secret, active) on public.webhooks to authenticated;
grant delete on public.webhooks to authenticated;
grant select, insert on public.webhook_deliveries to authenticated;
