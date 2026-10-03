# 19 — Schema-as-code CLI and starter kits

**Phase:** 3 Scale · **Estimate:** 5 days · **Prerequisites:** 18

## Goal

New client sites start in hours: content models and blocks are versioned as code and pushed to a space with one command. This closes Gate 3.

## Tasks

1. CLI `tools/novan-cli` (Node, `commander`), published as `@novan/cli`:
   - `novan login` (device-code flow against Supabase Auth, token stored in the OS keychain)
   - `novan schema pull --space <id>` → writes `novan/schema/*.json` (content types, block types)
   - `novan schema diff` → shows changes against the space
   - `novan schema push [--dry-run]` → applies changes through the Management API, refusing destructive changes without `--force`
   - `novan blocks sync` → reads block metadata from `@novan/blocks` and updates block types (name, fields, style options, preview images)
   - `novan seed --kit <name>` → creates starter pages
2. Starter kits in `kits/`: `brochure` (home, about, services, contact), `blog` (adds post type, listing block, RSS), `portfolio`. Each kit = schema JSON + seed content + optional extra blocks.
3. "New client site" runbook in `docs/clients/new-site.md`: create space → `schema push` → `seed` → copy starter site → set tokens and domain → deploy. Target: under one working day.
4. CI check: `novan schema diff` against staging for the starter site so code and CMS models stay in sync.

## Verify

Create a brand-new space on staging using only the CLI and a kit; the starter site renders it without manual admin work.

Gate 3 scenario: three client spaces in production with clients publishing their own changes for two weeks.

## Definition of done

- [ ] New site setup under one day following the runbook
- [ ] Gate 3 met and recorded
