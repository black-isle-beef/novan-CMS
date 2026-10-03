# api-db (`@novan/api-db`)

Database access for `apps/api`: the Drizzle schema and `DbModule`.

- `DbService.userDb(claims, tx => ...)` runs work as `authenticated` with `request.jwt.claims` set, so RLS applies. Use it for every user request.
- `DbService.serviceDb` bypasses RLS. Only for delivery reads (filtered by the space resolved from the API token) and background jobs.

## Schema

`src/schema.ts` is generated: SQL migrations in `supabase/migrations` are the source of truth. After changing a migration:

```bash
npm run db:reset   # re-apply migrations + seed
npm run db:pull    # regenerate src/schema.ts (tools/pull-schema.mjs)
npm run db:types   # regenerate libs/shared/types/src/lib/database.types.ts
```

`tools/pull-schema.mjs` wraps `drizzle-kit pull` and fixes two of its defects (undeclared `auth.users`, mis-paired composite foreign keys). `src/auth-schema.ts` declares the few Supabase `auth` columns the API references and is maintained by hand. drizzle-kit's `relations.ts` is not used because it inherits the composite-key bug.

## Tests

`nx test api-db`. The integration tests in `apps/api` need a running local database (`npm run db:start`).
