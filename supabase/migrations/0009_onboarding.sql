-- 0009 Onboarding checklist (package 11), stored in `spaces.settings.onboarding`:
--
--   { "completed": { "<step>": "<when it was first done>" }, "dismissedAt": "<when>" | null }
--
-- Spaces created through the API start with `{"completed": {}, "dismissedAt": null}`; a space without the key
-- (older and seeded spaces) shows no checklist. Updating `spaces` needs a space admin (0004), but every author
-- completes steps by doing them, so the API calls these two functions instead. They check membership through
-- the same JWT claims as RLS and change nothing but the checklist.

-- Steps in the order the admin lists them: add a logo, edit the home page, add a page, publish.
create function public.onboarding_steps()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['logo', 'homePage', 'newPage', 'publish'];
$$;

-- Records the first time a step was done. A no-op when the step is already done or the space has no checklist.
create function public.complete_onboarding_step(p_space_id uuid, p_step text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (p_step = any(public.onboarding_steps())) then
    raise exception 'unknown onboarding step %', p_step
      using errcode = 'invalid_parameter_value';
  end if;
  if not ((select public.is_agency_staff()) or (select public.has_space_role(p_space_id, '{admin,developer,editor,author}'))) then
    raise exception 'only authors and up complete onboarding steps'
      using errcode = 'insufficient_privilege';
  end if;

  update public.spaces
  set settings = jsonb_set(
    settings,
    '{onboarding,completed}',
    coalesce(settings #> '{onboarding,completed}', '{}'::jsonb) || jsonb_build_object(p_step, now())
  )
  where id = p_space_id
    and jsonb_typeof(settings -> 'onboarding') = 'object'
    and not coalesce(settings #> '{onboarding,completed}', '{}'::jsonb) ? p_step;
end;
$$;

-- Hides the checklist for everyone in the space. A no-op when it is already dismissed or there is none.
create function public.dismiss_onboarding(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ((select public.is_agency_staff()) or (select public.has_space_role(p_space_id, '{admin,developer,editor,author}'))) then
    raise exception 'only authors and up dismiss the onboarding checklist'
      using errcode = 'insufficient_privilege';
  end if;

  update public.spaces
  set settings = jsonb_set(settings, '{onboarding,dismissedAt}', to_jsonb(now()))
  where id = p_space_id
    and jsonb_typeof(settings -> 'onboarding') = 'object'
    and coalesce(settings #>> '{onboarding,dismissedAt}', '') = '';
end;
$$;

revoke execute on function public.complete_onboarding_step(uuid, text) from public, anon;
revoke execute on function public.dismiss_onboarding(uuid) from public, anon;
grant execute on function public.complete_onboarding_step(uuid, text) to authenticated;
grant execute on function public.dismiss_onboarding(uuid) to authenticated;
