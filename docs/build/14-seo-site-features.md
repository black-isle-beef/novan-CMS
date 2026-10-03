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

## Out of scope

Multilingual hreflang (16).

## Verify

```bash
npx nx test api starter-site cms-angular
npx nx e2e starter-site-e2e --grep @seo   # meta tags, canonical, redirect 301, sitemap includes new page, robots honours noindex
npx lhci autorun
```

## Definition of done

- [ ] Changing a page slug creates a working 301
- [ ] Lighthouse thresholds enforced in CI
