# 15 — Pilot client launch

**Phase:** 2 Visual editor + pilot · **Estimate:** 4 days · **Prerequisites:** 11–14, production environment from 20

## Goal

One real client site runs on Novan CMS in production, and the client publishes a page without help. This closes Gate 2.

## Tasks

1. Choose the pilot client and agree scope: pages, blocks needed beyond the five, launch date, who edits.
2. Create the client site from `apps/starter-site` (copy into `apps/<client>-site` or a separate repo using `@novan/cms-angular`). Apply the client's brand through Novan Design System tokens. Build any extra blocks with the `create-angular-cms-component` skill.
3. Production space: create the space, set `preview_url`, domains, roles; create delivery and preview tokens; configure Cloudflare DNS and cache rules for the client domain.
4. Content migration: script in `tools/migrate/<client>.ts` that creates pages and uploads media through the Management API (never direct SQL). Re-runnable and idempotent.
5. Client onboarding: invite the client as `editor`, run a 30-minute walkthrough, give a one-page "How to edit your site" guide (keep it in `docs/clients/editing-guide.md`, reusable for every client).
6. Launch checklist: redirects from the old site, sitemap submitted to Search Console, analytics, uptime check, backups confirmed, error tracking receiving events.
7. Two-week hypercare: log every question and issue the client raises in `docs/clients/<client>-feedback.md` and turn them into backlog items.

## Verify

Gate 2 scenario, observed not assisted: the client signs in, creates a new page from blocks, adds an image with alt text, publishes, and sees it live on their domain.

## Definition of done

- [ ] Client site live on production behind Cloudflare
- [ ] Gate 2 scenario passed and recorded
- [ ] Feedback log created and triaged
