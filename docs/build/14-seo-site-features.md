# 14 — SEO and site features

**Phase:** 2 Visual editor + pilot · **Estimate:** 3 days · **Prerequisites:** 10, 13

## Goal

Every client site ships with sound SEO defaults and the everyday site features editors expect.

## Tasks

1. SEO field group on the `page` type: meta title (with length counter), meta description, canonical override, Open Graph image (media field), `noindex`. Defaults fall back to page title and site settings.
2. SEO tab in the editor side panel with a search-result preview and social card preview.
3. Redirects: `redirects (id, space_id, from_path, to_path, status 301|302, created_at)` with RLS + pgTAP; admin screen with CSV import; automatic 301 when a published page's path changes. The Delivery API exposes `/v1/delivery/redirects`; the starter site applies them in its SSR server before rendering.
4. 404 tracking: the starter site reports misses to `POST /v1/delivery/not-found` (rate-limited, deduplicated per day); admin shows top 404s with "create redirect".
5. Navigation editor: tree editor for the `navigation` singleton (links to pages or external URLs), used by `ds-header`/`ds-footer`.
6. Site settings singleton screen: logo, favicon, contact details, social links, default OG image, analytics ID.
7. Structured data: `Organization` and `BreadcrumbList` JSON-LD from the SDK.
8. Lighthouse CI on the starter site in CI: performance ≥ 90, accessibility = 100, SEO = 100 on the seeded pages.

## Decisions made during this package

- **SEO fields** (seeded `page` type): `seo.metaTitle` (60) and `metaDescription` (160) already existed; `ogImage`
  (image, alt text required) and `canonical` (text, `https?://\S+`) are added. Every text field with a maximum now
  shows "12 of 60 characters" under it, as part of its description (`TextField`). Fallbacks: the search title is the
  page title, the site name is added by the site's title template, and `og:image` falls back to the site settings'
  sharing image (`applyNovanSeo({ defaultImage })`).
- **SEO tab:** the visual editor's side panel has Blocks and SEO tabs (`SeoPanel`, `libs/admin/editor`): the `seo`
  group with the page form's controls, a search-result preview (shortened as results are) and a social card preview.
  The pre-publish checklist sits below the tabs. The form view keeps the `seo` group in its form, without previews.
- **Redirects** (`0012_seo_site.sql`): `redirects` per space with `from_path` normalised (a path, no query, no
  trailing slash, unique per space), `to_path` a site path or an http(s) URL, `status` 301/302, and `created_by` (null
  for automatic ones). RLS: members read; editors and up write; pgTAP in `seo_site.test.sql`.
- **Automatic 301s are made by the database**, in an `after insert or update of full_path` trigger on
  `published_content` (pages of the main environment only), so every way an address changes is covered: a new slug
  published, a page moved (`EntriesService.move`) and a folder renamed or moved (the 0006 folder trigger). It also
  points earlier redirects at the new address (no chains) and drops any redirect from an address a page now has
  (no redirect hides a live page). Moves and folder changes are announced as `paths.changed`, which purges the CDN.
- **Management API** (`libs/api/site`, new): `GET/POST/PATCH/DELETE .../redirects`, `POST .../redirects/import` (up to
  5000, parsed from CSV in the admin with `parseRedirectsCsv` from `@novan/shared-schemas`, so problems are shown line
  by line before anything is sent) and `GET .../not-found`. 409 `redirect_exists`, `redirect_hides_page` (a published
  page has the address) and `redirect_loop` (a redirect straight back). Changes are audited and purge
  `redirects:<space>`.
- **Delivery:** `GET /v1/delivery/redirects` (and `/v1/preview/redirects`), cached under `redirects:<space>`;
  `POST /v1/delivery/not-found` (202, delivery tokens only, 60 a minute per token on top of the usual limit). The
  sitemap leaves out pages with `seo.noindex`.
- **404 tracking writes with the service role**, through `record_not_found(space, path, referrer)` (granted to
  `service_role` only), always for the space the delivery token resolves to: one row per address and UTC day counting
  visits, and at most 1000 new addresses per space and day, so a crawler cannot fill the table. The missing pages list
  leaves out addresses that now redirect. Purging old rows waits for the purge jobs in 17.
- **Starter site:** `createNovanRedirects` (SDK server entry) runs before Angular renders, reusing the list for
  `NOVAN_REDIRECTS_MAX_AGE_MS` (5 s) and serving redirects with the API's cache tags; a 404 render is reported with
  `createNovanNotFoundReporter` (not in preview). `SITE_URL` (or the request origin) is passed to the browser through
  transfer state for canonical links and structured data. Site settings give the header logo, the favicon, the
  footer's contact details and social links, the default sharing image, and GA4 (consent mode with storage denied by
  default, loaded after the first render, never in preview; a consent banner is not part of the starter site).
- **Structured data:** the SDK's `novanOrganizationJsonLd`, `novanBreadcrumbTrail` / `novanBreadcrumbJsonLd` and
  `applyNovanJsonLd` (one `<script type="application/ld+json">` per key, `<` escaped). Folders in the breadcrumb are
  named from their slug. SDK 0.5.0.
- **Admin:** Settings links to four new screens for every member: Site settings and Navigation (singleton editors:
  Save draft for authors and up, Publish changes for editors and up), Redirects (with CSV import and export) and
  Missing pages ("Redirect it" opens Redirects with the address filled in). The navigation editor arranges items with
  buttons (move up and down, into the item above and back out), not drag and drop.
- **Lighthouse CI** (`lighthouserc.json`, CI job `lighthouse`): the production build on port 4000 with the seeded
  tokens, three runs per page (`/`, `/about`, `/contact`), median scores asserted.

## Out of scope

Multilingual hreflang (16).

## Verify

```bash
npx nx test api starter-site cms-angular
npx nx e2e starter-site-e2e --grep @seo   # meta tags, canonical, redirect 301, sitemap includes new page, robots honours noindex
npx lhci autorun
```

## Definition of done

- [x] Changing a page slug creates a working 301
- [ ] Lighthouse thresholds enforced in CI
