# @black-isle-beef/cms-angular

The Angular SDK for Novan CMS. Client sites (Angular SSR) use it to fetch content, render pages built from
blocks and rich text, and support preview mode for the visual editor.

- `NovanContentService` reads the Delivery API, or the Preview API in preview mode. On the server it stores
  what it fetched in the page's transfer state, so the browser does not fetch it again.
- `<novan-blocks>` renders a block tree with your registered block components.
- `<novan-rich-text>` renders rich text without `innerHTML`.
- `novanImage`, `novanLinkHref`, `novanPageResolver` and `applyNovanSeo` cover images, links, routing and
  SEO.

Requires Angular 22 with `@angular/ssr`, and a Novan API (package 08) with a delivery token and,
for previews, a preview token.

## Install

```bash
npm install @black-isle-beef/cms-angular
```

The package is published to GitHub Packages, so point the scope at that registry in the site's `.npmrc`:

```ini
@black-isle-beef:registry=https://npm.pkg.github.com
```

## Set up

Tokens stay on the server. The browser bundle has no token: after the first page, the browser reads content
through the site's own server, which adds the token. The full example below compiles as part of this
package's checks (`examples/`).

**1. Server settings**, read from the environment (`NOVAN_API_URL`, `NOVAN_DELIVERY_TOKEN`,
`NOVAN_PREVIEW_TOKEN`). Only server code imports this file.

```ts
// examples/novan.server.ts
import type { NovanServerOptions } from '@black-isle-beef/cms-angular';
import { createNovanPreviewVerifier } from '@black-isle-beef/cms-angular/server';

const apiUrl = process.env['NOVAN_API_URL'] || 'http://localhost:3000';
const previewToken = process.env['NOVAN_PREVIEW_TOKEN'] || undefined;

// Server only: imported by server.ts and app.config.server.ts, never by browser code.
export const novanServerOptions: NovanServerOptions = {
  apiUrl,
  deliveryToken: process.env['NOVAN_DELIVERY_TOKEN'] ?? '',
  previewToken,
  // Checks the admin's signed preview links with the Preview API.
  verifyPreview: createNovanPreviewVerifier({ apiUrl, previewToken }),
};
```

**2. Server config** gives them to the SDK during server rendering:

```ts
// examples/app.config.server.ts
import { type ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, RenderMode, withRoutes } from '@angular/ssr';
import { provideNovanCmsServer } from '@black-isle-beef/cms-angular';
import { appConfig } from './app.config';
import { novanServerOptions } from './novan.server';

export const config = mergeApplicationConfig(appConfig, {
  providers: [
    provideServerRendering(withRoutes([{ path: '**', renderMode: RenderMode.Server }])),
    provideNovanCmsServer(novanServerOptions),
  ],
} satisfies ApplicationConfig);
```

**3. The proxy** in the site's server lets the browser read content after the first page. It passes only
the read routes of the Delivery and Preview APIs. The same server applies the CMS's redirects before rendering and
reports addresses with no page (see Redirects and missing pages):

```ts
// examples/server.ts
import { AngularNodeAppEngine, createNodeRequestHandler, writeResponseToNodeResponse } from '@angular/ssr/node';
import { createNovanNotFoundReporter, createNovanProxy, createNovanRedirects } from '@black-isle-beef/cms-angular/server';
import express from 'express';
import { novanServerOptions } from './novan.server';

const app = express();
const angularApp = new AngularNodeAppEngine();
const redirects = createNovanRedirects(novanServerOptions);
const reportNotFound = createNovanNotFoundReporter(novanServerOptions);

// The browser reads content through here after the first page; the proxy adds the token.
app.use('/_novan', createNovanProxy(novanServerOptions));

// Old addresses redirect before anything renders: the CMS's redirects, and pages whose address changed.
app.use((req, res, next) => void redirects.handle(req, res, next));

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => {
      if (!response) return next();
      // Editors see addresses with no page among the top 404s, and can redirect them.
      if (response.status === 404) void reportNotFound(req.path, req.get('referer'));
      return writeResponseToNodeResponse(response, res);
    })
    .catch(next);
});

export const reqHandler = createNodeRequestHandler(app);
```

**4. App config**, shared by the server and the browser, so it has no tokens:

```ts
// examples/app.config.ts
import { provideHttpClient, withFetch } from '@angular/common/http';
import type { ApplicationConfig } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { defineBlocks, provideNovanCms } from '@black-isle-beef/cms-angular';
import { routes } from './app.routes';
import { HeroBlock } from './hero.block';

// Shared by the server and the browser: no tokens here.
export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    provideNovanCms({
      blocks: defineBlocks({ hero: HeroBlock }),
    }),
  ],
};
```

`provideNovanCms` options: `blocks` (required), `locale` (only for a site in one language of a multilingual space,
say one domain per language: every call asks for it; without it the locale comes from each address, see Languages),
`proxyPath` (default `/_novan`), `apiUrl` and `publicDeliveryToken` (see below).

### Alternative: a public delivery token

A site whose content is entirely public can let the browser call the Delivery API directly. Pass
`apiUrl` and `publicDeliveryToken` to `provideNovanCms` and skip the proxy. The token is then in the browser
bundle, readable by anyone, and the API must allow the site's origin (CORS; at present it allows only the
admin). Preview never uses it. Use server-only tokens unless you have a reason not to.

## Pages

`novanPageResolver` loads the page at the route's address. When there is none it resolves to `null` and the
server answers 404:

```ts
// examples/app.routes.ts
import type { Routes } from '@angular/router';
import { novanPageResolver } from '@black-isle-beef/cms-angular';
import { CmsPage } from './cms-page';

export const routes: Routes = [
  // Every address is a CMS page; unknown ones resolve to null and answer 404. A `**` route has no params, so
  // the resolver must run again whenever the path changes.
  { path: '**', component: CmsPage, resolve: { page: novanPageResolver }, runGuardsAndResolvers: 'pathParamsChange' },
];
```

The page component renders the blocks and sets the SEO tags. `applyNovanSeo` sets the title, meta
description, canonical link, robots `noindex` and Open Graph tags from the page's `title` and `seo` fields; pass
`defaultImage` (the site settings' sharing image) for pages without one of their own. `applyNovanJsonLd` writes
structured data for search engines into the head (see Structured data).
`NovanPreview.withLiveData` shows the visual editor's unsaved changes (see Preview); elsewhere it returns the
page unchanged:

```ts
// examples/cms-page.ts
import { ChangeDetectionStrategy, Component, computed, effect, inject, Injector, input } from '@angular/core';
import {
  applyNovanJsonLd,
  applyNovanSeo,
  novanBreadcrumbJsonLd,
  novanBreadcrumbTrail,
  NovanBlocks,
  NovanPreview,
  type Page,
} from '@black-isle-beef/cms-angular';

const baseUrl = 'https://www.example.com';

@Component({
  selector: 'site-cms-page',
  imports: [NovanBlocks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main id="main-content">
      @if (shown(); as page) {
        <novan-blocks [blocks]="page.data.body" />
      } @else {
        <h1>Page not found</h1>
        <p>There is no page at this address.</p>
      }
    </main>
  `,
})
export class CmsPage {
  /** From the route's resolver (`withComponentInputBinding()`). */
  readonly page = input<Page | null>(null);

  private readonly injector = inject(Injector);
  private readonly preview = inject(NovanPreview);

  /** In the admin's visual editor, the page follows the editor's changes as they are made. */
  protected readonly shown = computed(() => this.preview.withLiveData(this.page()));

  constructor() {
    effect(() => {
      const page = this.shown();
      applyNovanSeo(page, { injector: this.injector, baseUrl });
      const trail = page ? novanBreadcrumbTrail(page) : [];
      applyNovanJsonLd('breadcrumbs', novanBreadcrumbJsonLd(trail, baseUrl), { injector: this.injector });
    });
  }
}
```

### Structured data

Search engines read JSON-LD from the HTML the server sends. The SDK builds two kinds, and `applyNovanJsonLd(key, data)`
writes each into the head as one `<script type="application/ld+json">` per key (null removes it):

- `novanOrganizationJsonLd(siteSettings, baseUrl)`: an `Organization` from the `siteSettings` singleton (name,
  logo, email, phone, address and social profiles as `sameAs`). Typed as `NovanSiteSettings`.
- `novanBreadcrumbJsonLd(trail, baseUrl)`: a `BreadcrumbList`. `novanBreadcrumbTrail(page)` gives the trail from the
  home page through each folder to the page; folders are named from their slug unless `names` maps their path to a
  name.

## Redirects and missing pages

`createNovanRedirects(options)` (`@black-isle-beef/cms-angular/server`) applies the CMS's redirects in the site's
server before Angular renders: those editors add, and the 301s the CMS makes when a published page's address changes.
It reads `GET /v1/delivery/redirects` and keeps the list for `maxAgeMs` (default 5 seconds); a redirect answer
carries the API's `Cache-Tag`s, so the CDN keeps it until a redirect changes. Paths match with or without a trailing
slash, and a redirect without a query of its own keeps the request's.

`createNovanNotFoundReporter(options)` returns a function to call when the server answers 404: it posts the path and
referrer to `POST /v1/delivery/not-found`, so editors see the most visited missing addresses and can redirect them.
It never throws. Both take the server options (`apiUrl` and `deliveryToken`) and run only on the server.

## Languages

A space can publish in several languages (docs/build/16-localisation.md). Every answer is in one locale: translated
fields hold that locale's text, or its fallback's. When the space puts the language in addresses (Settings ›
Languages in the admin), other languages than the default live under their prefix: `/fr/about` is the French
`/about`, `/fr` the French home page.

- `novanPageResolver` reads the locale from the address (`novanResolveLocale`, using `GET /v1/delivery/locales`) and
  asks for the page in it; a page with nothing to show in the locale, or its fallbacks, answers 404.
- The locale it read is `NovanLocale.current`; later calls (navigation, site settings) use it unless they name one.
  Resolve layout content per locale too: `novanResolveLocale(state.url)` in its resolver, and
  `runGuardsAndResolvers: 'always'` on the layout route so switching language reloads it.
- Delivered `path`s, internal links and site addresses in rich text are the site's addresses in the locale, so links
  stay in the language.
- `applyNovanSeo` sets `<html lang>`, an `hreflang` link per language the page is in (from `page.alternates`), an
  `x-default` link and `og:locale:alternate`; `applyNovanLang` sets `lang` for pages without content (404s).
- `novanBreadcrumbTrail` starts from the locale's home page (`/fr`).
- `content.sitemap()` lists each page once per locale it is in, with its `id`, so a sitemap can link a page's
  languages to each other.

## Blocks

A block component declares the block type it renders with `static readonly novanBlock = { apiId,
schemaVersion }`, and has one `input()` per field. `NovanBlock<TFields>` checks the inputs against the
fields:

```ts
// examples/hero.block.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type NovanAsset, type NovanBlock, novanImage, type NovanLinkValue, novanLinkHref } from '@black-isle-beef/cms-angular';

interface HeroFields {
  heading: string;
  subheading: string;
  image: NovanAsset | null;
  action: NovanLinkValue | null;
}

@Component({
  selector: 'site-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="py-11">
      <h1>{{ heading() }}</h1>
      @if (subheading()) {
        <p class="lead">{{ subheading() }}</p>
      }
      @if (image(); as image) {
        <img [src]="imageUrl()" [alt]="image.alt ?? ''" width="1200" height="600" />
      }
      @if (href(); as href) {
        <a class="btn btn-primary" [href]="href">{{ action()?.text || 'Find out more' }}</a>
      }
    </section>
  `,
})
export class HeroBlock implements NovanBlock<HeroFields> {
  static readonly novanBlock = { apiId: 'hero', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly subheading = input<string>();
  readonly image = input<NovanAsset | null>();
  readonly action = input<NovanLinkValue | null>();

  protected readonly href = computed(() => novanLinkHref(this.action()));
  protected readonly imageUrl = computed(() => novanImage(this.image(), { width: 1200, height: 600, fit: 'cover' }));
}
```

`defineBlocks({ hero: HeroBlock })` refuses a component registered under a different api id.

`<novan-blocks [blocks]="...">` sets each block's fields on the inputs with the same name and ignores
other fields. The style options an editor chose for the block (`_style`, e.g. `{ tone: 'brand' }`) go to a
`settings` input, as `null` when there are none; check them against your own options, because stored values
can be older than your component. Child blocks (`children`) go to a component with a `children` input, which places them with
its own `<novan-blocks>`. For a component without one, the renderer puts them after the block. A block with
no registered component shows nothing on the live site, and a warning box in preview. Blocks an editor hid
(`_hidden: true`) are never shown.

## Rich text

```html
<novan-rich-text [doc]="body()" />
```

This renders paragraphs, headings, lists, block quotes, code, rules, line breaks and images, plus bold,
italic, underline, strike, code, subscript, superscript and links. Site links (`/about`) use the router.
Only the elements and attributes above are created, and link and image addresses are checked: no
`javascript:` or `data:` links, no `script` or unknown elements, no event handler attributes. Text is always
rendered as text.

## Content

```ts
const content = inject(NovanContentService);

content.page('/about');                              // Observable<Page | null>
content.entries<Article>({                           // Observable<Paged<Article>>
  type: 'article',
  filter: { category: 'news', publishedOn: { gt: '2026-01-01' } },
  sort: '-fields.publishedOn',
  limit: 10,
});
content.entry(id);                                   // Observable<NovanEntry | null>
content.singleton<SiteSettings>('siteSettings');     // Observable<SiteSettings> (the singleton's data)
content.sitemap();                                   // Observable<NovanSitemap>
```

Errors from the API arrive as `NovanApiError`, carrying the HTTP `status` and the API's `code`.

## Images and links

- `novanImage(asset, { width, height, fit, quality })` gives a resized image URL from the API's image route.
  Preview files are signed URLs and come back unchanged.
- `novanLinkHref(link)` turns a `link` field into an address. It gives `null` for a page that is not
  published, and for anything unsafe.

## Preview

The admin opens preview links as `https://site/path?novan_preview=<signed token>`. The token is signed by the
API, lasts 15 minutes and is for one page. Preview mode is on only when the server accepts it through
`verifyPreview` in `NovanServerOptions`; `createNovanPreviewVerifier` (from `/server`, as in
`examples/novan.server.ts`) asks the Preview API (`GET /v1/preview/session`) with the site's preview token,
and keeps each answer for up to a minute. Without a verifier preview stays off, so adding the parameter never
shows drafts.

In preview mode:

- content comes from the Preview API (drafts) with the preview token;
- the page is served with `Cache-Control: private, no-store`, and content requests use `cache: 'no-store'`;
- the page is served with `Content-Security-Policy: frame-ancestors 'self' <admin>`, so only the admin can
  frame it;
- unknown blocks show a warning box;
- each block is wrapped in `<div data-novan-uid="..." data-novan-block="...">` for the visual editor.

`inject(NovanPreview).active()` tells components whether preview is on.

### Visual editor

When the preview page is open in the admin's visual editor (inside its frame), the SDK loads the bridge
(`@black-isle-beef/cms-angular/bridge`). Other visitors never download it. The bridge:

- outlines the block under the pointer and the selected block, with the block's name;
- tells the admin which block was clicked (links in it are not followed) and where every block is;
- applies the editor's changes as they are made: read the page through `NovanPreview.withLiveData(page)` in a
  `computed`, as `examples/cms-page.ts` does, and the page re-renders without reloading;
- takes the fresh signed token the admin sends before the old one expires;
- draws "+" buttons above and below the block under the pointer, for adding a block there;
- lets editors double-click a text field of the selected block to change it on the page. Mark the element that
  shows a field with `data-novan-field="heading"` to be sure it is found; without the mark, the bridge looks for
  the element whose whole text is the field's value.

It talks only to the admin's origin, which the Preview API gives with the session, and ignores every other
message.
## Develop

```bash
npx nx test cms-angular           # unit tests, including the rich text XSS suite and the proxy
npx nx build cms-angular          # ng-packagr build to dist/libs/cms-angular (checks this README's example first)
npx nx run starter-site:test-bundle   # no token in the starter site's browser bundle
```

## Publish

The version follows semver, starting at `0.1.0`. Record changes in `CHANGELOG.md`. Publishing is manual
for now:

```bash
npx nx build cms-angular
cd dist/libs/cms-angular
npm publish            # to https://npm.pkg.github.com (publishConfig), with a token that can write packages
```
