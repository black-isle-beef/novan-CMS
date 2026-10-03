# api-auth

Authentication and authorisation for the Novan API (package 03).

- `AuthGuard`: verifies the Supabase access token (HS256 secret or JWKS) and sets `req.user`. Agency staff
  must be at AAL2 unless the route has `@AllowAal1()`; `@RequireAgencyStaff()` limits a route to staff.
- `SpaceGuard`: resolves `:spaceId` against the `spaces` claim and checks `@RequireRole(...)`. It reads the
  same claims as the RLS helpers in `supabase/migrations/0003_auth_hook.sql`, so the API and RLS agree.
- `SupabaseAdmin`: service-role Auth admin client (invites). API server only.

Run `nx test api-auth` for unit tests; the guards are exercised end to end in `apps/api/src/app/management.spec.ts`.
