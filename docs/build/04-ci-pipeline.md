# 04 — CI pipeline

**Phase:** 0 Foundations · **Estimate:** 1.5 days · **Prerequisites:** 01–03

## Goal

Every PR is linted, unit-tested, database-tested, audited and e2e-tested automatically; `main` deploys to staging (deploy job added in 20).

## Tasks

1. `.github/workflows/ci.yml` on pull requests and pushes to `main`:
   - Setup: Node 24, `npm ci`, Nx cache (`actions/cache` on `.nx/cache`), `nrwl/nx-set-shas` for affected.
   - Job `lint-test-build`: `npx nx affected -t lint test build --parallel=3`.
   - Job `database`: `supabase/setup-cli`, `supabase start` (only db + auth + storage services via `-x` to exclude the rest), `supabase db reset`, `supabase test db`, `supabase db lint --level warning`, then check generated types are up to date (`db:types` then `git diff --exit-code`).
   - Job `audits`: run `.claude/skills/angular-scss-compliance-remediator/audit.ps1` with `pwsh` on affected Angular projects; fail on violations.
   - Job `e2e` (needs database): start api + admin, run `npx nx affected -t e2e`; Playwright tests include `@axe-core/playwright` checks; upload traces on failure.
2. Branch protection on `main`: require all jobs, one review (or self-review checklist if solo), linear history.
3. PR template `.github/pull_request_template.md` with the Definition of done checklist from `00-conventions.md`.
4. Dependabot (or Renovate) weekly for npm and GitHub Actions; group Angular and Nx updates.
5. Secret scanning and `npm audit --omit=dev --audit-level=high` as a non-blocking job that comments on the PR.

## Out of scope

Deployment jobs (20).

## Verify

- Open a PR that breaks a unit test, a pgTAP test, and an SCSS rule in turn: each fails the right job.
- A clean PR passes in under 15 minutes.

## Definition of done

- [ ] CI required on `main`
- [ ] Database tests and type drift check run in CI
- [ ] Accessibility and SCSS audits enforced
