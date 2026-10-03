# Repository settings for CI

These are GitHub settings, not workflow files, so a repository admin applies them once.

## Branch protection on `main`

Settings → Rules → Rulesets → New ruleset → **Import a ruleset** → `main.json`.

It requires the CI jobs `lint-test-build`, `database`, `audits`, `e2e` and `secrets` to pass on an up-to-date branch, a pull request with resolved conversations, and linear history (squash or rebase merges only). `npm-audit` is deliberately not required.

The required approval count is 0 while the project has one maintainer: use the self-review checklist in the PR template. Raise `required_approving_review_count` to 1 when a second reviewer joins.

## Secret scanning

Settings → Code security → enable **Secret scanning** and **Push protection**. The `secrets` CI job (TruffleHog) also scans every PR and push to `main`.
