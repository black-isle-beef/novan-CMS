-- 0004 Row-level security for tenancy tables.
--
-- Access comes from JWT claims (0003): `auth_space_ids()`, `has_space_role()`, `is_agency_staff()`.
-- Helpers are wrapped in `(select ...)` so Postgres evaluates them once per statement.
--
--   table          select                          insert / update / delete
--   organisations  agency staff, members' orgs     none (managed by the service role)
--   spaces         members, agency staff           insert: agency staff; update: agency staff, space admin
--   environments   members, agency staff           agency staff, space admin
--   roles          members, agency staff           agency staff, space admin
--   members        members, agency staff           agency staff, space admin
--   profiles       self, co-members, agency staff  update: self (display_name, avatar_url only)
--   audit_events   space admins, agency staff      insert: API service role only
--
-- Agency staff count only with a second factor (see is_agency_staff()).

-- ---------------------------------------------------------------------------
-- organisations
-- ---------------------------------------------------------------------------
create policy "organisations: agency staff and members read" on public.organisations
  for select to authenticated
  using (
    (select public.is_agency_staff())
    or exists (
      select 1 from public.spaces s
      where s.organisation_id = organisations.id and s.id = any((select public.auth_space_ids())::uuid[])
    )
  );

-- ---------------------------------------------------------------------------
-- spaces
-- ---------------------------------------------------------------------------
create policy "spaces: members and agency staff read" on public.spaces
  for select to authenticated
  using (id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "spaces: agency staff create" on public.spaces
  for insert to authenticated
  with check ((select public.is_agency_staff()));

create policy "spaces: admins and agency staff update" on public.spaces
  for update to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(id, '{admin}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(id, '{admin}')));

-- ---------------------------------------------------------------------------
-- environments, roles, members: read for members, write for space admins
-- ---------------------------------------------------------------------------
create policy "environments: members and agency staff read" on public.environments
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "environments: admins and agency staff write" on public.environments
  for all to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')));

create policy "roles: members and agency staff read" on public.roles
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "roles: admins and agency staff write" on public.roles
  for all to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')));

create policy "members: members and agency staff read" on public.members
  for select to authenticated
  using (space_id = any((select public.auth_space_ids())::uuid[]) or (select public.is_agency_staff()));

create policy "members: admins and agency staff write" on public.members
  for all to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')))
  with check ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')));

-- ---------------------------------------------------------------------------
-- profiles: rows are created by the auth.users trigger; users edit only their display fields
-- ---------------------------------------------------------------------------
create policy "profiles: self, co-members and agency staff read" on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_agency_staff())
    or exists (
      select 1 from public.members m
      where m.user_id = profiles.user_id and m.space_id = any((select public.auth_space_ids())::uuid[])
    )
  );

create policy "profiles: self update" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- `is_agency_staff` is never writable by users.
revoke insert, update, delete, truncate on table public.profiles from anon, authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- audit_events: read by space admins; written only by the API as service_role (bypasses RLS)
-- ---------------------------------------------------------------------------
create policy "audit events: admins and agency staff read" on public.audit_events
  for select to authenticated
  using ((select public.is_agency_staff()) or (select public.has_space_role(space_id, '{admin}')));

revoke insert on table public.audit_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- anon never touches tenancy tables.
-- ---------------------------------------------------------------------------
revoke all on table
  public.organisations, public.spaces, public.environments, public.roles,
  public.members, public.profiles, public.audit_events
from anon;
