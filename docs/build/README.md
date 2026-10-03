# Novan CMS — build instructions

These files turn the **Novan CMS — Build Plan** into runnable work packages. Each file is one unit of work that can be handed to a developer or to Claude Code, built, tested and signed off before the next one starts.

## How to run a work package

1. Read `00-conventions.md` once. Every package assumes it.
2. Open the next package in the order below and check its **Prerequisites** are done.
3. Run it. With Claude Code, open a session at the repo root and say:

   > Follow `docs/build/<file>.md`. Work through the tasks in order, run the tests in the Verify section, and stop when the Definition of done is met. Ask me before changing anything listed under Out of scope.

4. Run everything under **Verify**. All of it must pass.
5. Tick the **Definition of done** checklist in the file, commit, and open a PR titled `[<package id>] <title>`.

Packages are sized at 2–6 days for one developer. If one is running much longer, split it rather than pushing on.

## Order of work

| ID | File | Phase | Weeks | Gate |
| --- | --- | --- | --- | --- |
| 00 | `00-conventions.md` | All | — | Read first |
| 01 | `01-workspace-scaffold.md` | 0 Foundations | 1 | |
| 02 | `02-supabase-setup.md` | 0 Foundations | 1 | |
| 03 | `03-auth-tenancy-rls.md` | 0 Foundations | 1–2 | |
| 04 | `04-ci-pipeline.md` | 0 Foundations | 2 | **Gate 0:** you can log in and create a client space |
| 05 | `05-content-modelling.md` | 1 Headless core | 3–4 | |
| 06 | `06-entries-versions.md` | 1 Headless core | 4–5 | |
| 07 | `07-media-library.md` | 1 Headless core | 5 | |
| 08 | `08-delivery-preview-api.md` | 1 Headless core | 6 | |
| 09 | `09-angular-sdk.md` | 1 Headless core | 6–7 | |
| 10 | `10-blocks-starter-site.md` | 1 Headless core | 7 | **Gate 1:** starter site renders every page from the CMS |
| 11 | `11-admin-shell-client-mode.md` | 2 Visual editor + pilot | 8 | |
| 12 | `12-visual-editor.md` | 2 Visual editor + pilot | 8–10 | |
| 13 | `13-workflow-publishing.md` | 2 Visual editor + pilot | 10–11 | |
| 14 | `14-seo-site-features.md` | 2 Visual editor + pilot | 11 | |
| 15 | `15-pilot-launch.md` | 2 Visual editor + pilot | 12 | **Gate 2:** pilot client publishes a page without help |
| 16 | `16-localisation.md` | 3 Scale | 13–14 | |
| 17 | `17-scheduling-releases-webhooks.md` | 3 Scale | 14–15 | |
| 18 | `18-search-forms-audit.md` | 3 Scale | 16–17 | |
| 19 | `19-schema-cli-starter-kits.md` | 3 Scale | 18–19 | **Gate 3:** three clients editing their own sites |
| 20 | `20-deployment.md` | Runs alongside 04, then every phase | — | First production deploy before 15 |
| 21 | `21-testing-strategy.md` | Reference for every package | — | |
| 22 | `22-phase-4-backlog.md` | 4 Grow | 20+ | Built only when a client asks |

`20-deployment.md` is not a one-off: set up staging during phase 0 (after 04), production before the pilot (15), and follow its release checklist on every deploy.

## Gates

A gate is a demo, not a feeling. Before starting the next phase, run the gate scenario end to end on **staging** and record the result in the PR that closes the phase.

## Keeping these files current

When a decision changes, update the file that owns it and `00-conventions.md` if it affects every package. Don't let code and instructions drift: the instructions are what the next session (human or Claude) will trust.
