# @novan/cms-angular

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
npm install @novan/cms-angular
```

The package is published to GitHub Packages, so point the scope at that registry in the site's `.npmrc`:

```ini
@novan:registry=https://npm.pkg.github.com
```

## Set up

Tokens stay on the server. The browser bundle has no token: after the first page, the browser reads content
through the site's own server, which adds the token. The full example below compiles as part of this
package's checks (`examples/`).

**1. Server settings**, read from the environment (`NOVAN_API_URL`, `NOVAN_DELIVERY_TOKEN`,
`NOVAN_PREVIEW_TOKEN`). Only server code imports this file.

```ts
// examples/novan.server.ts
import type { NovanServerOptions } from '@novan/cms-angular';

// Server only: imported by server.ts and app.config.server.ts, never by browser code.
export const novanServerOptions: NovanServerOptions = {
  apiUrl: process.env['NOVAN_API_URL'] || 'http://localhost:3000',
  deliveryToken: process.env['NOVAN_DELIVERY_TOKEN'] ?? '',
  previewToken: process.env['NOVAN_PREVIEW_TOKEN'] || undefined,
};
```

**2. Server config** gives them to the SDK during server rendering:

```ts
// examples/app.config.server.ts
import { type ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, RenderMode, withRoutes } from '@angular/ssr';
import { provideNovanCmsServer } from '@novan/cms-angular';
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
the read routes of the Delivery and Preview APIs:

```ts
// examples/server.ts
import { AngularNodeAppEngine, createNodeRequestHandler, writeResponseToNodeResponse } from '@angular/ssr/node';
import { createNovanProxy } from '@novan/cms-angular/server';
import express from 'express';
import { novanServerOptions } from './novan.server';

const app = express();
const angularApp = new AngularNodeAppEngine();

// The browser reads content through here after the first page; the proxy adds the token.
app.use('/_novan', createNovanProxy(novanServerOptions));

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
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
import { defineBlocks, provideNovanCms } from '@novan/cms-angular';
import { routes } from './app.routes';
import { HeroBlock } from './hero.block';

// Shared by the server and the browser: no tokens here.
export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    provideNovanCms({
      locale: 'en-GB',
      blocks: defineBlocks({ hero: HeroBlock }),
    }),
  ],
};
```

`provideNovanCms` options: `blocks` (required), `locale` (default: the space's default locale),
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
import { novanPageResolver } from '@novan/cms-angular';
import { CmsPage } from './cms-page';

export const routes: Routes = [
  // Every address is a CMS page; unknown ones resolve to null and answer 404. A `**` route has no params, so
  // the resolver must run again whenever the path changes.
  { path: '**', component: CmsPage, resolve: { page: novanPageResolver }, runGuardsAndResolvers: 'pathParamsChange' },
];
```

The page component renders the blocks and sets the SEO tags. `applyNovanSeo` sets the title, meta
description, canonical link, robots `noindex` and Open Graph tags from the page's `title` and `seo` fields:

```ts
// examples/cms-page.ts
import { ChangeDetectionStrategy, Component, effect, inject, Injector, input } from '@angular/core';
import { applyNovanSeo, NovanBlocks, type Page } from '@novan/cms-angular';

@Component({
  selector: 'site-cms-page',
  imports: [NovanBlocks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main id="main-content">
      @if (page(); as page) {
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

  constructor() {
    effect(() => applyNovanSeo(this.page(), { injector: this.injector, baseUrl: 'https://www.example.com' }));
  }
}
```

## Blocks

A block component declares the block type it renders with `static readonly novanBlock = { apiId,
schemaVersion }`, and has one `input()` per field. `NovanBlock<TFields>` checks the inputs against the
fields:

```ts
// examples/hero.block.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type NovanAsset, type NovanBlock, novanImage, type NovanLinkValue, novanLinkHref } from '@novan/cms-angular';

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
other fields. Child blocks (`children`) go to a component with a `children` input, which places them with
its own `<novan-blocks>`. For a component without one, the renderer puts them after the block. A block with
no registered component shows nothing on the live site, and a warning box in preview.

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

The admin opens preview links as `https://site/path?novan_preview=<signed token>`. Preview mode is on only
when the server accepts that token through `verifyPreview` in `NovanServerOptions`. Without a verifier,
preview stays off, so adding the parameter never shows drafts. Package 12 adds the signed-token exchange
that supplies the verifier.

In preview mode:

- content comes from the Preview API (drafts) with the preview token;
- the page is served with `Cache-Control: private, no-store`, and content requests use `cache: 'no-store'`;
- unknown blocks show a warning box;
- the visual editor bridge (`@novan/cms-angular/bridge`) is loaded. Other visitors never download it.

`inject(NovanPreview).active()` tells components whether preview is on.

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
