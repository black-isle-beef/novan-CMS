---
name: angular-site-seo-architect
description: "Use when implementing, auditing, or refactoring SEO in the Novan CMS Angular apps: the cms-angular SDK's applyNovanSeo and JSON-LD helpers, the page type's SEO fields, canonical URLs, Open Graph, Twitter cards, robots directives, sitemap.xml and robots.txt from the Delivery API, redirects and 404s, index.html defaults, SSR safety, or technical SEO validation of the starter site and marketing site."
---

# Angular Sitewide SEO Architect

Act as a Principal Web Architect and Technical SEO Specialist for this repository. SEO is a centralized, typed system. Inspect the existing implementation, tests and `docs/build/14-seo-site-features.md` before editing. Preserve behavior, and never hardcode production domains, company names, contact details or social URLs in components: on client sites they come from the CMS.

If the user passed an argument, treat it as the scope. With no argument, audit `apps/starter-site` together with the SDK (`libs/cms-angular`), then `apps/web`.

## Repository Context

Nx monorepo; run targets through Nx, with `npx.cmd` on Windows PowerShell. Unset `NX_WORKSPACE_ROOT_PATH` before Angular tests (`$env:NX_WORKSPACE_ROOT_PATH = $null`).

### Client sites (`apps/starter-site` + the SDK): content-driven SEO

Pages are CMS content rendered by one catch-all route, so SEO metadata comes from each page's fields, not from route data. The pieces, and where changes belong:

| Concern | Where it lives |
| --- | --- |
| SEO fields | The `page` type's `seo` group (`supabase/seed.sql`): `metaTitle` (60), `metaDescription` (160), `ogImage` (image, alt required), `canonical` (`https?://\S+`), `noindex`. Editors edit them in the visual editor's SEO tab (`libs/admin/editor`, `SeoPanel`) |
| Site-wide defaults | The `siteSettings` singleton: site name, logo, favicon, `defaultOgImage`, contact details, social links, analytics ID (`apps/starter-site/src/app/site/site-content.ts`) |
| Title, description, canonical, robots, Open Graph | `applyNovanSeo(page, { baseUrl, titleTemplate, siteName, defaultImage })`, `libs/cms-angular/src/lib/seo.ts`, called from `apps/starter-site/src/app/cms-page/cms-page.ts`. It removes tags a page leaves empty, so nothing lingers between navigations |
| JSON-LD | `novanOrganizationJsonLd`, `novanBreadcrumbTrail` / `novanBreadcrumbJsonLd`, `applyNovanJsonLd` (one `<script type="application/ld+json">` per key, `<` escaped), `libs/cms-angular/src/lib/structured-data.ts` |
| Absolute URLs | The `SITE_URL` token (`apps/starter-site/src/app/site/site-url.ts`): `SITE_URL` env on the server, else the request origin, passed to the browser through transfer state |
| sitemap.xml, robots.txt | Express routes in `apps/starter-site/src/server.ts` (`src/server/sitemap.ts`), built from `GET /v1/delivery/sitemap`, which leaves out pages with `seo.noindex` |
| Redirects, 404s | `createNovanRedirects` and `createNovanNotFoundReporter` (SDK server entry) in `server.ts`; automatic 301s on path changes come from the database |

Rules:

- Behavior every client site needs goes into the SDK (`libs/cms-angular`), with tests, a README section, a version bump and a CHANGELOG entry. The starter site is the reference integration.
- Never publish `localhost` canonicals in production; canonicals and JSON-LD URLs come from `SITE_URL`.
- Preview mode (`PREVIEW_PARAM`) and the editor's frame must not be indexed or reported as visits.
- Multilingual `hreflang` is package 16; do not build it here.

### Marketing site (`apps/web`)

A static Angular app with route-defined pages (`apps/web/src/app/app.routes.ts`, `src/index.html`). The route-driven pattern below applies here.

### Admin (`apps/admin`)

Behind sign-in and never meant for search results; the only SEO concern is keeping it out of the index (`noindex`).

## Route-Driven Metadata (route-defined apps such as `apps/web`)

- One `SeoService` (`Title`, `Meta`, `DOCUMENT`) applies a typed config on every `NavigationEnd`, using the deepest active route's `data.seo` merged with site defaults. No per-page subscriptions.

  ```typescript
  export interface SeoConfig {
    title: string;
    description: string;
    image?: string;
    type?: 'website' | 'article';
    noIndex?: boolean;
    canonicalUrl?: string;
    jsonLd?: Record<string, unknown>;
  }
  ```

- Upsert `description`, `robots`, `og:*` and `twitter:*` tags; exactly one `<link rel="canonical">` with an absolute URL; one managed JSON-LD script, removed when not configured.
- Site-wide values (production origin, company name, default image) come from one typed site config. Ask the repository owner for the real production origin; never invent one.
- Reuse the SDK's helpers where they fit instead of duplicating them.
- Static `public/sitemap.xml` and `public/robots.txt` only for a static site, with absolute URLs on the configured origin and no noindex routes.

## Document Defaults

Each app's `src/index.html` has `lang`, charset, viewport, a default title and existing favicon references. Runtime metadata overwrites the defaults by the same `name`/`property` key, so no duplicates accumulate. Do not invent descriptions or claims.

## JSON-LD Requirements

Valid Schema.org: `Organization` from site settings (name, logo, `sameAs` from social links, contact point), `BreadcrumbList` from the page path, and page-specific types (`WebSite`, `AboutPage`, `ContactPage`, `Article`) only when content supports them. All URLs are absolute. Serialize with `JSON.stringify` and escape `<`. No secrets, tracking IDs or unverified business claims.

## SSR and URL Safety

- Use `DOCUMENT` for all head access; never the `window`, `document` or `location` globals. Server-rendered HTML must already carry the final title, meta, canonical and JSON-LD; verify the SSR response, not only the browser DOM.
- Canonicals are normalized: one trailing-slash policy (none, except `/`), no fragments, no query unless the canonical strategy needs it.
- Keep `robots.txt` from disallowing CSS, JavaScript or images the page needs, and point it to the sitemap on the same origin.

## Validation Workflow

```powershell
$env:NX_WORKSPACE_ROOT_PATH = $null
npx.cmd nx run-many -t lint test build -p cms-angular starter-site
npx.cmd nx e2e starter-site-e2e --grep @seo
```

The `@seo` e2e tests cover meta tags, canonical, the redirect 301, the sitemap including a new page, and robots honoring `noindex`. They need the local stack: `npx.cmd supabase start`. Then:

1. Serve the production build and check the server-rendered `<head>` of `/`, `/about`, `/contact` and a missing page (`Invoke-WebRequest http://localhost:4000/<path>`): title, description, robots, Open Graph, Twitter, a single canonical, JSON-LD that parses.
2. Navigate client-side between pages and confirm tags are replaced, not accumulated.
3. Fetch `/sitemap.xml` (parses as XML, absolute URLs, no noindex pages) and `/robots.txt` (same origin, points at the sitemap).
4. Add focused unit tests for new behavior: title template, noindex, canonical replacement, JSON-LD replacement and removal, construction without browser globals.
5. UI changes (the SEO tab, settings screens) must also pass the `angular-accessibility-audit-remediator` and `angular-scss-compliance-remediator` skills.

Report changed files, the pages and routes covered, production-origin assumptions, validation results, and anything intentionally excluded from indexing. Never claim SEO compliance from a source scan alone; verify the rendered head.
