# 00 — Conventions (read before every package)

## Product in one paragraph

Novan CMS is a multi-tenant, headless-first CMS with an in-house visual page editor. novan web services uses it to run client sites built on the Novan Design System, and clients edit their own content inside guard rails. It is self-hosted for now and must stay **SaaS-ready**: nothing may assume a single agency.

## Locked decisions

| Area | Decision |
| --- | --- |
| Monorepo | Nx 23, TypeScript 6, one repo (`novan-CMS`) |
| Platform | Supabase: Postgres, Auth, Storage, Realtime, pg_cron, Queues. One project per environment (local, staging, production), **not** one per client |
| API | NestJS on Node 24 (`apps/api`), container-deployed. No CMS logic in Supabase Edge Functions |
| Data access | Drizzle ORM (`postgres` driver) in the API; Supabase's client in the admin only for auth, storage uploads and realtime, as its separate packages (`@supabase/auth-js`, `@supabase/storage-js`) so each loads with the screens that need it (package 11) |
| Schema source of truth | SQL migrations in `supabase/migrations`. Drizzle schema is pulled from the database (`drizzle-kit pull`), never hand-edited to diverge |
| Admin | Angular 22 standalone app (`apps/admin`), Novan Design System, Angular CDK |
| Client sites | Angular SSR behind Cloudflare, purged on publish. Prerender only static routes |
| Visual editor | Built in-house: iframe + bridge script + side panel. No third-party canvas |
| Validation | Zod schemas in `libs/shared/schemas`, used by API and admin |
| Rich text | Tiptap, stored as ProseMirror JSON |
| Tests | Vitest (unit), pgTAP via `supabase test db` (RLS), Nest testing + Supertest (API integration), Playwright + axe (e2e) |

Changing any of these needs a written decision in the build plan first.

## Repository layout

```
apps/
  web/            marketing site (exists)
  admin/          CMS admin + visual editor
  api/            NestJS Novan API + job processors
  starter-site/   template client site (Angular SSR)
libs/
  shared/types/   domain + generated database types
  shared/schemas/ Zod schemas (fields, blocks, API payloads)
  api/*           NestJS feature libs (auth, spaces, content, media, delivery, ...)
  admin/*         Angular feature libs (schema, editor, media, users, settings)
  cms-angular/    @black-isle-beef/cms-angular SDK (publishable)
  blocks/         Novan CMS blocks (one folder per block)
supabase/
  config.toml, migrations/, tests/ (pgTAP), seed.sql
docs/build/       these instructions
```

## Multi-tenancy rules (non-negotiable)

- Every tenant table has `space_id uuid not null` (or reaches a space through a parent with one) and **row-level security enabled**.
- RLS policies check membership through JWT claims set by the custom access token hook (package 03). Never trust a `space_id` sent by the client without checking membership.
- The API runs user requests inside a transaction that sets `role authenticated` and `request.jwt.claims`, so RLS applies to API traffic too. The `service_role` connection is used only by delivery reads (always filtered by the space resolved from the API token), the Delivery API's not-found reports (`record_not_found`, for the token's space, package 14) and background jobs.
- The Supabase service-role key exists only in the API's server environment. Never in the admin, the SDK or a client site.
- Every new table ships with a pgTAP test proving a member of space A cannot read or write space B.

## Coding standards

- Strict TypeScript, no `any` without a comment explaining why.
- Angular: standalone components, signals, `OnPush`, control flow (`@if`, `@for`), inject() over constructor injection, no NgModules.
- Styles come from the Novan Design System. Component SCSS must pass the repo's `angular-scss-compliance-remediator` audit.
- Accessibility: WCAG 2.2 AA. UI work must pass the repo's `angular-accessibility-audit-remediator` audit and axe checks in e2e.
- NestJS: one module per feature in `libs/api/<feature>`; DTOs validated with Zod (`nestjs-zod` or a ZodValidationPipe); no business logic in controllers.
- API routes: `/v1/management/...` (authenticated users), `/v1/preview/...` (preview token), `/v1/delivery/...` (delivery token). JSON, kebab-case paths, camelCase fields.
- Errors: RFC 9457 problem+json responses with a stable `code`.
- Dates in UTC ISO 8601. IDs are UUID v7 (`gen_random_uuid()` acceptable until a v7 function is added).
- Plain-language UI copy in client-facing screens: "page", "publish", "save draft" — never "entry", "environment", "content type".

## Environments and secrets

| Name | Where | Notes |
| --- | --- | --- |
| local | `npx supabase start` (Docker Desktop) + `nx serve` | `.env.local`, never committed |
| staging | Supabase project `novan-staging` (London) + staging host | Auto-deploy from `main` |
| production | Supabase project `novan-prod` (London) + production host | Deploy from a tagged release |

Required variables are listed in `.env.example` (created in package 02). Add new variables there in the same PR that uses them.

## Git and PRs

- Branch per package: `feat/<id>-<slug>`, e.g. `feat/05-content-modelling`.
- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- A PR must: pass CI, include tests for new behaviour, include migrations + pgTAP tests for schema changes, and update `docs/build` if a decision changed.

## Definition of done (applies to every package)

- [ ] All tasks in the package complete; nothing listed as out of scope was built
- [ ] `npx nx affected -t lint test build` passes locally
- [ ] `npx supabase db reset && npx supabase test db` passes (if the database changed)
- [ ] New UI passes the accessibility and SCSS audits and its Playwright tests
- [ ] `.env.example`, generated database types and API docs (OpenAPI) are updated
- [ ] Deployed to staging and smoke-tested
- [ ] Package file's own Definition of done ticked

## Useful commands

```bash
npx supabase start                 # local Postgres, Auth, Storage, Studio
npx supabase db reset              # re-run all migrations + seed
npx supabase migration new <name>  # new SQL migration
npx supabase test db               # pgTAP tests in supabase/tests
npx supabase gen types typescript --local > libs/shared/types/src/lib/database.types.ts
npx nx serve api | admin | starter-site
npx nx affected -t lint test build
npx nx e2e admin-e2e
```
