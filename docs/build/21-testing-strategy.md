# 21 — Testing strategy (reference)

Every package's Verify section draws on these layers. When in doubt, test at the lowest layer that can catch the bug.

| Layer | Tool | Lives in | What it covers | Runs |
| --- | --- | --- | --- | --- |
| Unit | Vitest | next to code (`*.spec.ts`) | Pure logic: Zod schemas, workflow state machine, diffing, renderers, signals stores | Every PR (affected) |
| Database | pgTAP via `supabase test db` | `supabase/tests/*.test.sql` | RLS policies, triggers, constraints, functions; **cross-tenant isolation for every table** | Every PR touching `supabase/` (always in CI) |
| API integration | Nest testing module + Supertest against local Supabase | `apps/api/src/**/*.int.spec.ts`, `apps/api-e2e` | Endpoints end to end with real Postgres: auth, permissions, validation, delivery caching headers | Every PR |
| Component | Vitest + Angular TestBed + axe | `libs/admin/*`, `libs/blocks`, `libs/cms-angular` | Forms, editor panels, blocks, accessibility of each component | Every PR |
| E2E | Playwright + `@axe-core/playwright` | `apps/admin-e2e`, `apps/starter-site-e2e` | User journeys tagged `@auth @schema @content @media @editor @workflow @seo @forms @i18n` | Every PR (affected), full suite nightly |
| Performance | autocannon (API), Lighthouse CI (sites) | `tools/perf`, `lighthouserc.json` | Delivery p95 < 100 ms, Lighthouse perf ≥ 90 | Nightly + before release |
| Smoke | Playwright `@smoke` subset | `apps/admin-e2e` | Sign in, open editor, publish, page live | After every deploy |

## Rules

- A bug fix starts with a failing test at the lowest layer that reproduces it.
- Every new table or policy: pgTAP tests for allowed and denied access, including another space's member.
- Every new endpoint: one test per role that should be denied.
- Every new block: unit test, axe test, and the field-definition drift test from package 10.
- E2E tests create their own space through the API and clean up; they never depend on each other or on seed content beyond users.
- Tests use the local Supabase stack; never point tests at staging or production.

## Test data

- `supabase/seed.sql`: minimal users, one organisation, one demo space.
- `tools/fixtures/`: factories (`createSpace`, `createPage`, `uploadAsset`) that call the Management API, shared by API integration and e2e tests.
