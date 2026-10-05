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

## Decisions made during this package

- **A block's style options live in its data as `_style`**, next to `_uid` and `_block`:
  `{ "_uid": "…", "_block": "hero", "_style": { "tone": "dark" }, "heading": "…" }`. Values are named presets
  and switches only (`buildEntrySchema` refuses `#fff`-style values) and are not checked against the block
  type's `style_options`. The component falls back to its default for anything it does not know, so renaming
  an option never invalidates stored pages. `<novan-blocks>` (SDK 0.2.0) passes `_style` to a component's
  `settings` input, or `null`. The visual editor (12) writes `_style` from its preset pickers.
- **Block contract:** one `input()` per field (as `<novan-blocks>` sets them), plus `settings`. This differs
  from the skill's single `content` input. `block-types.spec.ts` reads `supabase/seed.sql` and checks each
  component's inputs, field types (including inside groups) and style options against its seeded block type.
- **Block styles are global partials** in `libs/blocks/src/styles` (`@use 'novan-blocks'`, with that folder on
  the site's `stylePreprocessorOptions.includePaths`), because the SCSS audit forbids component stylesheets.
  The design system declares only colour, elevation and motion custom properties globally. Spacing therefore
  comes from its Sass tokens (`$ds-spacing-scale-*`), and `starter-site:test-bundle` fails if a partial uses
  a custom property that the built stylesheet does not declare on `:root`.
- **Tones** (`light`, `brand`, `dark`) are one shared mixin of token pairs. On brand and dark, links and focus
  rings switch to the inverse colour, and buttons use the design system's `btn-hero-light`.
- **Caching:** an HTTP interceptor merges the `Cache-Tag` of every Delivery API answer used in a server
  render (page, navigation, site settings, 404 content) into the response, capped at 15 KB with
  `overflow:<space>`. `server.ts` then sends `public, s-maxage=31536000, stale-while-revalidate=60` only for
  a 200 that carries tags and has no `Cache-Control` set during the render. Everything else is `no-store`:
  404s, 503s, preview (which already sets `private, no-store`), and any render in which an API call failed,
  because a failed answer has no tags to purge the page by.
- **Routes:** a layout route resolves the `navigation` and `siteSettings` singletons once. Its `**` child uses
  `novanPageResolver`; a missing page shows the `notFound` singleton (or a built-in message) with status 404,
  and an API failure shows an apology with status 503. A page whose blocks include no hero gets its title as
  the `h1`. After client-side navigation, focus moves to `main`.
- **Singletons** added to the seed: `navigation` (`items` with `subItems`, and `footerGroups`), `siteSettings`
  (`siteName`, `organisationName`) and `notFound` (`title`, `body` blocks).
- **Local seed data:** two generated images in the private `media` bucket, uploaded on `db reset` from
  `supabase/seed/media` (`[storage.buckets.media]` in `config.toml`, repeating 0007's bucket settings), and a
  fixed, public delivery token for local use. `nx serve starter-site` reads that token from the committed
  `apps/starter-site/.env.serve`; override it with `.env.serve.local` (git-ignored) or a real environment
  variable. The e2e config passes no `env` to its web servers, because Nx then could not start them as tasks.
- **Gate 1** runs locally as its own Playwright project (`gate-1.spec.ts`), after the browser projects. It
  signs in as the seeded admin, publishes a new About title, reloads the site, checks the title, and puts the
  old title back.
- **`SITE_URL`** sets the sitemap and robots addresses and the host Angular's server renders for. Angular
  refuses other hosts (SSRF protection); add more with `NG_ALLOWED_HOSTS`. Production must set it.
- **The Dockerfile** builds from the repository root and runs `node server/server.mjs` as the image's `node`
  user on port 4000. The server bundle includes its dependencies, so the image holds only `dist/`.
- **Budget:** all blocks are in the initial bundle (they render on every page), so the starter site's
  initial-bundle warning is 850 kB, up from 800 kB.

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

- [x] Five blocks with tests and editor panels
- [x] Starter site fully CMS-driven, SSR, correct cache headers
- [ ] Gate 1 passes on staging (passes locally: `gate-1.spec.ts`; staging and Cloudflare come with package 20)
