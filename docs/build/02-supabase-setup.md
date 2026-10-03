# 02 — Supabase and database foundations

**Phase:** 0 Foundations · **Estimate:** 2 days · **Prerequisites:** 01

## Goal

Local Supabase running from the repo, the core tenancy tables migrated, Drizzle connected from the API, and generated types shared with the front-ends.

## Context

- SQL migrations in `supabase/migrations` are the source of truth (RLS policies are SQL). Drizzle schema is pulled from the database.
- Docker Desktop must be running for `supabase start` on Windows.

## Tasks

1. `npx supabase init` at repo root. In `supabase/config.toml` set the project name, enable email auth with confirmations, set `site_url` to the admin dev URL, and add the admin dev URL to `additional_redirect_urls`.
2. Migration `0001_tenancy.sql`:
   - `organisations (id, name, plan text default 'agency', created_at)`
   - `spaces (id, organisation_id, name, slug unique, default_locale default 'en-GB', preview_url, settings jsonb default '{}', created_at)`
   - `environments (id, space_id, name, is_main bool, cloned_from_id, created_at)`; create a `main` environment for each new space via trigger
   - `roles (id, space_id, key, name, permissions jsonb)`; seed default roles per space via trigger: `admin`, `developer`, `editor`, `author`, `viewer`
   - `members (space_id, user_id references auth.users, role_id, invited_by, created_at, primary key (space_id, user_id))`
   - `profiles (user_id pk references auth.users, display_name, avatar_url, is_agency_staff bool default false)`
   - Enable RLS on every table (policies come in package 03; until then nothing is readable by `authenticated`, which is correct).
3. Migration `0002_audit.sql`: `audit_events (id, space_id, actor_id, action, target_type, target_id, diff jsonb, created_at)` — append-only (no update/delete grants).
4. `supabase/seed.sql`: one organisation "Novan Web Services", one space "Demo site", and two test users created via `auth.users` inserts for local only (`agency@novan.test`, `client@novan.test`, password `password123`).
5. Drizzle in the API: install `drizzle-orm`, `postgres`, `drizzle-kit`. Add `drizzle.config.ts` pointing at `DATABASE_URL`, run `npx drizzle-kit pull` into `libs/api/db/src/schema.ts`. Create a `DbModule` exposing two clients: `userDb(claims)` (runs inside a transaction with `set local role authenticated` and `set_config('request.jwt.claims', ...)`) and `serviceDb` (service role, for delivery reads and jobs only).
6. Generate types: add an Nx target `db:types` that runs `supabase gen types typescript --local` into `libs/shared/types/src/lib/database.types.ts`.
7. Create `.env.example` with `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` (or JWKS URL), `API_PORT`, `ADMIN_URL`. Document local values printed by `supabase status`.
8. Add npm scripts: `db:start`, `db:reset`, `db:test`, `db:types`, `db:pull`.

## Out of scope

RLS policies (03), content tables (05+), production projects (20).

## Verify

```bash
npm run db:start && npm run db:reset
npm run db:types && npx nx build shared-types
npx nx test api          # DbModule test: serviceDb can select from spaces; userDb without claims sees 0 rows
```

## Definition of done

- [ ] Fresh clone + `db:start` + `db:reset` gives a working seeded database
- [ ] Every table has RLS enabled (`select relname from pg_class where relrowsecurity = false and relnamespace = 'public'::regnamespace` returns nothing)
- [ ] Drizzle schema and generated types match the migrations
- [ ] `.env.example` complete
