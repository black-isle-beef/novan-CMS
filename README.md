# Novan CMS

Novan Web Services Content Management System: a multi-tenant headless CMS with an in-house visual editor, built on Supabase, NestJS and Angular in an Nx monorepo.

Build instructions, locked decisions and conventions live in [`docs/build/`](docs/build/README.md).

## Prerequisites

- **Node 24** (`.nvmrc` pins it: `nvm use`) and npm 11+
- **Docker Desktop**, running, for the local Supabase stack (from package 02 onwards)
- Git

## Setup

```bash
git clone https://github.com/black-isle-beef/novan-CMS.git
cd novan-CMS
nvm use              # Node 24
npm ci
npx playwright install   # browsers for the e2e suites (once per machine)
npm run dev
```

`npm run dev` starts these in parallel:

| Project        | URL                          | What it is                               |
| -------------- | ---------------------------- | ---------------------------------------- |
| `api`          | http://localhost:3000/health | NestJS Novan API                         |
| `admin`        | http://localhost:4200        | CMS admin and visual editor              |
| `starter-site` | http://localhost:4300        | Template client site (Angular SSR)       |

The marketing site runs separately with `npx nx serve web` (port 4200, so stop `admin` first).

## Scripts

| Command         | Does                                             |
| --------------- | ------------------------------------------------ |
| `npm run dev`   | Serve `api`, `admin` and `starter-site`          |
| `npm run build` | Build every project                              |
| `npm test`      | Unit tests (Vitest) for every project            |
| `npm run lint`  | ESLint, including Nx module-boundary rules       |
| `npm run e2e`   | API e2e (Vitest) and Playwright suites           |

Run one project with `npx nx <target> <project>`, e.g. `npx nx test api`. `npx nx graph` shows how projects depend on each other.

## Layout

```
apps/
  web/            marketing site
  admin/          CMS admin + visual editor           (+ admin-e2e)
  api/            NestJS Novan API                     (+ api-e2e)
  starter-site/   template client site, Angular SSR    (+ starter-site-e2e)
libs/
  shared/types/   @novan/shared-types   domain + generated database types
  shared/schemas/ @novan/shared-schemas Zod schemas used by API and admin
  api/            NestJS feature libs (one per feature)
  admin/          Angular feature libs for the admin
  cms-angular/    @black-isle-beef/cms-angular    publishable Angular SDK
  blocks/         @novan/blocks         Novan CMS blocks
docs/build/       build instructions
```

Every project is tagged `scope:*` and `type:*`. Lint enforces that `admin` and site projects never import `scope:api` code, and that `@black-isle-beef/cms-angular` only imports `scope:shared` libs. See `eslint.config.mjs`.

## Troubleshooting

- **"Vitest failed to find the runner" in Angular tests on Windows**: an `NX_WORKSPACE_ROOT_PATH` variable with a different drive-letter case from your shell (`c:\` vs `C:\`) makes Vitest load twice. Unset it, or open the terminal from the same casing.
