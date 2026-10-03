# 10 — First blocks and the starter site

**Phase:** 1 Headless core · **Estimate:** 4 days · **Prerequisites:** 09

## Goal

Five Novan CMS blocks and a starter client site that renders every page from the CMS with Angular SSR and correct caching. This closes Gate 1.

## Tasks

1. Create blocks in `libs/blocks` with the `create-angular-cms-component` skill, one at a time: `hero`, `richText`, `image`, `featureGrid`, `cta`. Each ships with its styling-options schema, editor panel, Vitest unit tests and axe tests. Field definitions must match the block types seeded in 05; add a unit test that compares each component's declared inputs with its seeded field definition so they cannot drift.
2. Export `novanBlocks = defineBlocks({...})` from `@novan/blocks`.
3. Starter site (`apps/starter-site`):
   - Catch-all route `**` with `novanPageResolver`; 404 page from a CMS singleton (fallback built-in).
   - Layout with `ds-header` / `ds-footer` fed by `navigation` and `siteSettings` singletons (add these content types to the seed).
   - Server routes config: catch-all `RenderMode.Server`; `/health` route.
   - Set response headers in the SSR server for CMS pages: `Cache-Control: public, s-maxage=31536000, stale-while-revalidate=60` and pass through `Cache-Tag` from the Delivery API response.
   - `sitemap.xml` and `robots.txt` server routes built from `/v1/delivery/sitemap`.
4. Seed content: home, about, contact pages using all five blocks, plus navigation and site settings.
5. Dockerfile for the starter site (multi-stage, Node 24 alpine, non-root user) — used by 20.

## Out of scope

Visual editing (12), forms (18).

## Verify

```bash
npm run db:reset
npx nx run-many -t test -p blocks starter-site
npx nx serve api & npx nx serve starter-site
curl -sI http://localhost:4000/about | grep -i cache-control
npx nx e2e starter-site-e2e     # every seeded page renders; view-source contains content; axe passes; unknown path -> 404
```

Gate 1 scenario: change the About page title in the admin, publish, reload the starter site — the new title appears (on staging, within 5 seconds through Cloudflare).

## Definition of done

- [ ] Five blocks with tests and editor panels
- [ ] Starter site fully CMS-driven, SSR, correct cache headers
- [ ] Gate 1 passes on staging
