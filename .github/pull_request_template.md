## What and why

<!-- Package (docs/build/NN-*.md) and a short summary of the change. -->

## Definition of done

From [`docs/build/00-conventions.md`](../docs/build/00-conventions.md). Strike through anything that does not apply and say why.

- [ ] All tasks in the package complete; nothing listed as out of scope was built
- [ ] `npx nx affected -t lint test build` passes locally
- [ ] `npx supabase db reset && npx supabase test db` passes (if the database changed)
- [ ] New UI passes the accessibility and SCSS audits and its Playwright tests
- [ ] `.env.example`, generated database types and API docs (OpenAPI) are updated
- [ ] Deployed to staging and smoke-tested
- [ ] Package file's own Definition of done ticked

## Review

<!-- Solo? Do a self-review against the checklist below before merging. -->

- [ ] New tables have RLS enabled and a pgTAP test proving space A cannot read or write space B
- [ ] The Supabase service-role key is used only in `apps/api`
- [ ] Tests cover the new behaviour
- [ ] `docs/build` is updated if a decision changed
