# admin-auth

Sign-in for the admin (package 03): the Supabase client (anon key only), `AuthService`, route guards, the
API auth interceptor (adds the token, refreshes once on 401), and the sign-in, password reset, invite
acceptance, two-step verification and account pages.

Agency staff must verify a second factor (AAL2) before using the admin; the API and RLS enforce the same rule.

Run `nx test admin-auth` (unset `NX_WORKSPACE_ROOT_PATH` first if Vitest "failed to find the runner").
