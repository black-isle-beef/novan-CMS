-- 0026 How a space's site is built (`spaces.settings.site`): `novanStyles` false means the site's build leaves out the
-- Novan design system and Bootstrap (docs/clients/new-site.md). A missing value means they are in, as for every space
-- that existed before this setting.
--
-- It decides what an agency builds and ships, so, like the media settings (0023), only agency staff change it. A
-- trigger rather than a policy, because RLS cannot compare a row's old and new values. It checks requests made as
-- `authenticated` or `anon` only; the API's service connection and migrations are not limited.

create function public.guard_space_site_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.settings -> 'site') is distinct from (old.settings -> 'site')
     and current_user in ('authenticated', 'anon')
     and not (select public.is_agency_staff()) then
    raise exception 'only agency staff change a space''s site settings'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_space_site_settings() from public, anon, authenticated;

create trigger spaces_guard_site_settings
before update of settings on public.spaces
for each row execute function public.guard_space_site_settings();
