# 03 — Auth, tenancy and row-level security

**Phase:** 0 Foundations · **Estimate:** 4 days · **Prerequisites:** 02

## Goal

Users can sign in to the admin, see only the spaces they belong to, and agency staff can create a client space and invite a client. Tenant isolation is enforced in the database and proven by tests.

## Tasks

### Database

1. Custom access token hook (`0003_auth_hook.sql`): a `public.custom_access_token_hook(event jsonb)` function that adds `spaces: [{ id, role }]` and `agency_staff: bool` claims from `members`/`profiles`. Enable it in `config.toml` under `[auth.hook.custom_access_token]`. Grant execute to `supabase_auth_admin` only.
2. Helper SQL functions (security definer, stable): `auth_space_ids()`, `has_space_role(space uuid, roles text[])`, `is_agency_staff()`, reading from `auth.jwt()`.
3. RLS policies (`0004_rls_tenancy.sql`):
   - `spaces`: select where `id = any(auth_space_ids())` or agency staff; insert/update only agency staff or space admin.
   - `members`, `roles`, `environments`: select for members of the space; write for space admins.
   - `profiles`: users read/update their own; members of a shared space can read display names.
   - `audit_events`: select for space admins; insert only through the API service role.
4. pgTAP tests in `supabase/tests/tenancy.test.sql` using `tests.authenticate_as()` helpers (install `basejump-supabase_test_helpers` or write equivalents): member of space A cannot select, insert, update or delete rows in space B for every table; viewer cannot write; agency staff can read all.

### API (`libs/api/auth`, `libs/api/spaces`)

5. `AuthGuard` verifying the Supabase JWT (JWKS or JWT secret), exposing `req.user` with claims. `SpaceGuard` resolving `:spaceId` and checking membership/role from claims. Decorator `@RequireRole('admin','editor')`.
6. Endpoints: `GET /v1/management/me`, `GET /v1/management/spaces`, `POST /v1/management/spaces` (agency staff), `GET|POST|PATCH|DELETE /v1/management/spaces/:spaceId/members`, `POST /v1/management/spaces/:spaceId/invites` (uses Supabase admin `inviteUserByEmail`, then inserts the member with the chosen role).
7. Every write records an `audit_events` row.

### Admin (`libs/admin/auth`, `libs/admin/spaces`)

8. Supabase client service (anon key) with session persistence; sign-in page (email + password, magic link), sign-out, password reset, invite acceptance page.
9. MFA: enrol TOTP from the account page; require AAL2 for agency staff (enforce in API guard too).
10. Space switcher in the header; "Create space" form for agency staff; Members page with invite and role change.
11. HTTP interceptor adding the access token to API calls and refreshing it on 401.

## Out of scope

Google/Microsoft sign-in (configure later in 20), custom roles editor UI, billing.

## Verify

```bash
npm run db:reset && npm run db:test         # all tenancy tests pass
npx nx test api                             # guards: missing token 401, wrong space 403, viewer write 403
npx nx e2e admin-e2e --grep @auth           # sign in, create space, invite client, client sees only that space
```

Gate 0 scenario (record in the PR): agency user signs in with 2FA, creates "Acme Ltd" space, invites `client@novan.test` as editor; client accepts, signs in, sees only Acme Ltd.

## Definition of done

- [ ] Cross-tenant pgTAP tests cover every table created so far
- [ ] JWT carries space claims; API and RLS agree on access
- [ ] Gate 0 scenario passes on staging (after 04 + 20 staging setup)
