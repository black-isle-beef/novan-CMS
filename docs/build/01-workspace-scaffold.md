# 01 â€” Workspace scaffold

**Phase:** 0 Foundations Â· **Estimate:** 2 days Â· **Prerequisites:** none

## Goal

Turn the existing Nx workspace (one app, `apps/web`) into the full monorepo layout from `00-conventions.md`, with every project building, linting and running an empty test.

## Context

- Existing: Nx 23.2, Angular 22.1, Vitest 4, `@black-isle-beef/novan-design-system` ^2.5.0, `apps/web` landing page. Keep `apps/web` untouched apart from shared lint config.
- Generators change between Nx versions. Before each generator, run it with `--dry-run` and check flags with `--help`.

## Tasks

1. Add plugins: `npx nx add @nx/nest`, `npx nx add @nx/eslint`, `npx nx add @nx/playwright`.
2. Generate the API: `npx nx g @nx/nest:app apps/api` (this also creates `apps/api-e2e`). The Nest generator defaults to Jest; replace it with Vitest (`vitest` + `unplugin-swc` so decorators compile) so the whole repo uses one test runner. Add a `/health` endpoint returning `{ status: 'ok', version }`.
3. Generate the admin: `npx nx g @nx/angular:app apps/admin --style=scss --unitTestRunner=vitest-angular --e2eTestRunner=playwright --ssr=false --prefix=nv`. Import the design system styles the same way `apps/web/src/styles.scss` does. Render a placeholder "Sign in" page using `ds-header`.
4. Generate the starter site: `npx nx g @nx/angular:app apps/starter-site --style=scss --ssr --unitTestRunner=vitest-angular --e2eTestRunner=playwright --prefix=site`. Confirm `nx serve starter-site` renders server-side (view source shows content).
5. Generate libraries:
   - `libs/shared/types` and `libs/shared/schemas` (`@nx/js:lib`, Vitest, no bundler) with import paths `@novan/shared-types`, `@novan/shared-schemas`. Add `zod` as a dependency.
   - `libs/cms-angular` (`@nx/angular:lib --publishable --importPath=@novan/cms-angular`).
   - `libs/blocks` (`@nx/angular:lib --importPath=@novan/blocks`).
   - Create empty folders `libs/api/` and `libs/admin/` with a README explaining that feature libs are generated there per package.
6. Tags and boundaries: tag projects `scope:api`, `scope:admin`, `scope:site`, `scope:shared`, `type:app|feature|data|ui|util`. Add `@nx/enforce-module-boundaries` rules so `scope:admin` and `scope:site` can never import `scope:api`, and `cms-angular` may import only `scope:shared`.
7. Root scripts in `package.json`: `dev` (api + admin + starter-site in parallel), `test`, `lint`, `e2e`.
8. Add `.editorconfig`, Prettier config, and `.nvmrc` with Node 24.
9. Update the root `README.md` with setup steps (Node 24, Docker Desktop for Supabase, `npm ci`, `npm run dev`).

## Out of scope

Supabase, database, auth, any real feature UI.

## Verify

```bash
npm ci
npx nx run-many -t lint test build
npx nx serve api           # GET http://localhost:3000/health -> {"status":"ok"}
npx nx serve admin         # sign-in placeholder styled by the design system
npx nx serve starter-site  # page HTML visible in view-source
npx nx graph               # admin and starter-site have no edge to api
```

## Definition of done

- [x] All projects from the layout exist and build
- [x] One test runner (Vitest) across the repo
- [x] Module boundary lint rule fails if admin imports an api lib (prove it with a throwaway import, then remove it)
- [x] README setup steps work on a clean clone
