-- 0020 Forms (docs/build/18-search-forms-audit.md): what visitors send through `form` blocks on published pages, and
-- each space's form settings.
--
--   table             select                          insert / update / delete
--   form_submissions  space admins, editors, staff    delete: the same; insert: the API's own connection only
--   form_settings     space admins, editors, staff    insert / update: space admins, agency staff
--
-- Submissions hold personal data, so authors, viewers and developers do not see them. They arrive through the Delivery
-- API (`POST /v1/delivery/forms/:formUid/submit`), which checks the form against the published page, so only the API's
-- own connection inserts them. Each is kept for the space's retention period (12 months unless set), then deleted by
-- the nightly housekeeping. The people in `recipients` get an email for each submission (the `notifications` queue).

create table public.form_settings (
  space_id uuid primary key references public.spaces (id) on delete cascade,
  recipients text[] not null default '{}'
    check (cardinality(recipients) <= 10 and array_position(recipients, null) is null),
  retention_months integer not null default 12 check (retention_months between 1 and 120),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index form_settings_updated_by_idx on public.form_settings (updated_by);

create trigger form_settings_set_updated_at
  before update on public.form_settings
  for each row execute function public.set_updated_at();

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  -- The page the form is on; kept when the page is later deleted for good.
  entry_id uuid,
  -- The form block's `_uid`.
  form_uid text not null check (length(form_uid) between 1 and 100),
  -- The form's heading when it was sent, for the inbox.
  form_name text check (length(form_name) <= 200),
  page_path text check (length(page_path) <= 1000),
  locale text check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  -- Values by field name, as checked against the form.
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  -- The form's fields when it was sent, in order: `[{ "name", "label", "type" }]`.
  fields jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),
  created_at timestamptz not null default now(),
  foreign key (entry_id, space_id) references public.entries (id, space_id) on delete set null (entry_id)
);

create index form_submissions_space_id_created_at_idx on public.form_submissions (space_id, created_at desc, id desc);
create index form_submissions_form_idx on public.form_submissions (space_id, form_uid, created_at desc);
create index form_submissions_entry_id_idx on public.form_submissions (entry_id);
create index form_submissions_created_at_idx on public.form_submissions (created_at);

alter table public.form_settings enable row level security;
alter table public.form_submissions enable row level security;

create policy "form settings: admins, editors and agency staff read" on public.form_settings
  for select to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,editor}')));
create policy "form settings: admins and agency staff create" on public.form_settings
  for insert to authenticated
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')));
create policy "form settings: admins and agency staff change" on public.form_settings
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')));

create policy "form submissions: admins, editors and agency staff read" on public.form_submissions
  for select to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,editor}')));
create policy "form submissions: admins, editors and agency staff delete" on public.form_submissions
  for delete to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin,editor}')));

revoke all on public.form_settings, public.form_submissions from public, anon, authenticated, service_role;
grant select, insert, update on public.form_settings to authenticated;
grant select, delete on public.form_submissions to authenticated;

-- ---------------------------------------------------------------------------
-- Emails about new submissions go through a queue of their own, so they survive a restart (0014).
-- ---------------------------------------------------------------------------
select pgmq.create('notifications');

revoke all on all tables in schema pgmq from public, anon, authenticated, service_role;
revoke all on all sequences in schema pgmq from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Retention: deletes up to `batch` submissions older than their space's retention period; returns how many.
-- ---------------------------------------------------------------------------
create function public.purge_expired_form_submissions(batch integer default 1000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from public.form_submissions f
  where f.id in (
    select s.id
    from public.form_submissions s
    left join public.form_settings c on c.space_id = s.space_id
    where s.created_at < now() - make_interval(months => coalesce(c.retention_months, 12))
    order by s.created_at
    limit batch
  );
  get diagnostics purged = row_count;
  return purged;
end;
$$;

revoke execute on function public.purge_expired_form_submissions(integer) from public, anon, authenticated, service_role;

-- The nightly housekeeping (0018) gains the retention purge.
select cron.schedule(
  'housekeeping',
  '30 3 * * *',
  $$
    select pgmq.send('housekeeping', '{"type": "purge-bin"}'::jsonb);
    select pgmq.send('housekeeping', '{"type": "purge-assets"}'::jsonb);
    select pgmq.send('housekeeping', '{"type": "prune-autosaves"}'::jsonb);
    select pgmq.send('housekeeping', '{"type": "purge-form-submissions"}'::jsonb);
  $$
);
