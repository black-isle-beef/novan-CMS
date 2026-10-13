-- 0022 Device sign-in for the Novan CLI (docs/build/19-schema-cli-starter-kits.md), after RFC 8628.
--
--   table                   select / insert / update / delete
--   device_authorizations   the API's own connection only
--
-- `novan login` asks the API for a code pair: a secret device code the CLI keeps (stored here only as its SHA-256)
-- and a short user code the person types into the admin at /device. Signed in there, they approve or deny it through
-- `decide_device_authorization`, which records who approved. The CLI polls with its device code; once approved, the
-- API marks the row used and hands the CLI a one-time sign-in for that person. Codes live for 10 minutes; the API
-- deletes rows a day after they expire.
--
-- The table is not tenant data (it belongs to a person, not a space), so it has no space_id. Nobody but the API's own
-- connection reads it: the pre-sign-in steps have no user to apply RLS to, and the one signed-in step goes through the
-- function below.

create table public.device_authorizations (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 of the device code, hex.
  device_code_hash text not null unique check (device_code_hash ~ '^[0-9a-f]{64}$'),
  -- Eight consonants (no vowels, so no words), shown as BCDF-GHJK.
  user_code text not null unique check (user_code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{8}$'),
  -- What asked, e.g. "Novan CLI on build-laptop", shown on the approval page.
  client_name text not null check (length(client_name) between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'used')),
  -- Who approved: set exactly when the code was approved (and later used).
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  last_polled_at timestamptz,
  check ((status in ('approved', 'used')) = (user_id is not null)),
  check ((status = 'pending') = (decided_at is null))
);

create index device_authorizations_expires_at_idx on public.device_authorizations (expires_at);
create index device_authorizations_user_id_idx on public.device_authorizations (user_id);

alter table public.device_authorizations enable row level security;
revoke all on public.device_authorizations from public, anon, authenticated, service_role;

-- Approves or denies a pending, unexpired code as the signed-in person. The code is matched without its hyphen and
-- in any case. Answers the new status, or `not_found` for a code that is unknown, expired or already decided.
create function public.decide_device_authorization(code text, approve boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalised text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z]', '', 'g'));
  decided text;
begin
  if caller is null then
    raise exception 'Sign in to approve a device.' using errcode = '42501';
  end if;

  update public.device_authorizations d
  set status = case when approve then 'approved' else 'denied' end,
      user_id = case when approve then caller end,
      decided_at = now()
  where d.user_code = normalised and d.status = 'pending' and d.expires_at > now()
  returning d.status into decided;

  return coalesce(decided, 'not_found');
end;
$$;

revoke all on function public.decide_device_authorization(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.decide_device_authorization(text, boolean) to authenticated;
