# Novan CMS

Multi-tenant headless CMS with an in-house visual editor, built on Supabase + NestJS + Angular in an Nx monorepo.

- Build instructions live in `docs/build/`. Start with `docs/build/README.md` for the order of work and `docs/build/00-conventions.md` for the locked decisions, layout, multi-tenancy rules and definition of done.
- When asked to "follow" a package file, do its tasks in order, run its Verify section, and stop at its Definition of done. Don't build anything listed under Out of scope.
- Never weaken row-level security, expose the Supabase service-role key outside `apps/api`, or skip the pgTAP cross-tenant tests.
- UI work must pass the repo skills `angular-accessibility-audit-remediator` and `angular-scss-compliance-remediator`.
- New CMS blocks are created with the `create-angular-cms-component` skill.
