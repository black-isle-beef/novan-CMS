-- 0023 Media settings of a space (`spaces.settings.media`), such as `allowSvg` (docs/build/07-media-library.md).
--
-- Space admins may update their space (0004), and so its `settings`. Allowing SVG is a security choice the agency
-- makes for a site (uploads are sanitised, but the file type stays off by default), so only agency staff may change
-- `settings.media`. A trigger rather than a policy, because RLS cannot compare a row's old and new values. It checks
-- requests made as `authenticated` or `anon` only; the API's service connection and migrations are not limited.

create function public.guard_space_media_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.settings -> 'media') is distinct from (old.settings -> 'media')
     and current_user in ('authenticated', 'anon')
     and not (select public.is_agency_staff()) then
    raise exception 'only agency staff change a space''s media settings'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_space_media_settings() from public, anon, authenticated;

create trigger spaces_guard_media_settings
before update of settings on public.spaces
for each row execute function public.guard_space_media_settings();
