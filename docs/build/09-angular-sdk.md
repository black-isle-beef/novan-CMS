# 09 — Angular SDK (`@novan/cms-angular`)

**Phase:** 1 Headless core · **Estimate:** 4 days · **Prerequisites:** 08

## Goal

A publishable Angular library that any client site installs to fetch content, render block trees with registered components, and support preview mode and the visual editor bridge.

## Public API

```ts
provideNovanCms({
  apiUrl: string,
  deliveryToken: string,          // server-side only via environment / process.env
  previewToken?: string,          // only used when preview mode is on
  locale?: string,
  blocks: NovanBlockRegistry,     // from defineBlocks(...)
});

defineBlocks({ hero: HeroBlock, richText: RichTextBlock, ... });

NovanContentService
  .page(path, opts?): Observable<Page | null>
  .entries<T>(query): Observable<Paged<T>>
  .singleton<T>(apiId): Observable<T>

<novan-blocks [blocks]="page.data.body" />     // renders a block tree
<novan-rich-text [doc]="field" />              // ProseMirror JSON -> safe Angular DOM
novanImage(asset, { width, height, fit })      // transformed URL builder
novanPageResolver                              // route resolver: path -> page, 404 when null
```

## Tasks

1. `NovanContentService` using `HttpClient` with SSR transfer state so data fetched on the server is not refetched in the browser. Tokens are read from server environment only; the browser bundle must not contain the delivery token (fetch through the site's own SSR server, or use a public read-only delivery token if the site is fully public — document both, default to server-only).
2. `<novan-blocks>`: maps `_block` to the registered component via `NgComponentOutlet`/`ViewContainerRef.createComponent`, passes fields as inputs using `setInput`, renders `children` recursively, renders a visible warning box in preview mode (nothing in production) for unknown blocks.
3. Block contract: each block component declares `static readonly novanBlock = { apiId, schemaVersion }` and typed `input()`s matching its field definitions. Provide a `NovanBlock<TFields>` helper type.
4. `<novan-rich-text>`: renderer for paragraphs, headings, lists, links (internal links resolved to paths), bold/italic/underline, blockquote, embedded images. No `innerHTML`.
5. Preview mode: when the URL has `?novan_preview=<signed token>` (issued by the admin), switch to the Preview API, disable caching (`Cache-Control: no-store`), and load the bridge (package 12) lazily.
6. SEO helper: `applyNovanSeo(page)` sets title, meta description, canonical, Open Graph tags via `Meta`/`Title`.
7. Package build with ng-packagr, README with install and usage, `CHANGELOG.md`, semver starting at `0.1.0`. Publish target to GitHub Packages (manual for now).

## Decisions made during this package

- **Tokens never go through `provideNovanCms`.** It holds only browser-safe settings (`apiUrl`, `locale`,
  `blocks`, `proxyPath`). The server adds `{ apiUrl, deliveryToken, previewToken, verifyPreview }` with
  `provideNovanCmsServer` in `app.config.server.ts`, read from `NOVAN_API_URL`, `NOVAN_DELIVERY_TOKEN` and
  `NOVAN_PREVIEW_TOKEN` in a server-only module (`apps/starter-site/src/novan.server.ts`).
- **By default the browser reads content through the site's server.** `createNovanProxy` (secondary entry
  `@novan/cms-angular/server`, mounted at `/_novan`) adds the token and passes only GET/HEAD of the read routes:
  `/_novan/{delivery|preview}/{pages|entries|entries/:id|singletons/:apiId|sitemap}`. Delivery answers keep
  their `Cache-Control`, `ETag` and `Cache-Tag`. The opt-in `publicDeliveryToken` lets the browser call the
  Delivery API directly. That needs the API's CORS to allow the site's origin, which it does not yet (admin
  only), so deployment (20) has to decide it if any site wants it.
- **Transfer state is the SDK's own.** Keys are `novan:<delivery|preview>:<endpoint>?<sorted params>`, each
  used once by the browser. 404 answers are kept too (as `null`). Angular's HTTP transfer cache is off for
  these requests, because the server and the browser call different URLs.
- **Preview needs the server to accept the signed token.** `?novan_preview=<token>` turns preview on only if
  `verifyPreview(token)` returns true and a preview token is configured. Without a verifier, which is the case
  until package 12 adds the signed-token exchange, preview stays off, so the parameter alone never shows
  drafts. The verdict travels to the browser in transfer state (`novan:preview`). The signed token goes to the
  proxy and the Preview API as `X-Novan-Preview`, and the proxy checks it again on every request. Preview
  pages are served with `Cache-Control: private, no-store` (through `RESPONSE_INIT`).
- **The bridge is the secondary entry `@novan/cms-angular/bridge`**, imported dynamically in preview only
  (its own lazy chunk in the site). It is a stub until package 12.
- **Blocks:** a block's fields are set on the inputs with the same name (other fields are ignored). A
  component with a `children` input gets the child blocks to place itself; otherwise they render after it.
  Nodes without `_uid`/`_block` and repeated `_uid`s are skipped. `defineBlocks` refuses a component whose
  `novanBlock.apiId` differs from its key. No `data-novan-uid` wrappers yet (12 adds them).
- **Rich text:** the document becomes a checked model first (known nodes and marks, safe `href`/`src`, heading
  levels 1–6, depth ≤ 50), which a template-only component renders. Link marks use `href`. A mark with an
  `entryId` uses its `path` instead, for when the API starts resolving rich-text links to pages (today the
  editor stores plain hrefs). Images are `image` nodes with `src`/`alt` or an expanded `asset`; the editor
  has no image node yet. Safe addresses are the editor's list, plus a refusal of `/\host`, which browsers
  read as `//host`.
- **API additions to the sketch:** `entry(id)` and `sitemap()` on the service. `singleton<T>()` returns the
  singleton's `data`. `novanLinkHref(link)` handles `link` fields, and `NovanApiError` carries the API's
  `code`.
- **`novanPageResolver`** resolves to `null` with status 404 for a missing page, and for an address no page
  can have (it does not ask the API). On a `**` route it needs `runGuardsAndResolvers: 'pathParamsChange'`.
- **`applyNovanSeo`** reads `seo.metaTitle`, `metaDescription` and `noindex` (seeded now), plus `canonical` and
  `ogImage` (package 14 adds them to the `page` type). It removes tags the page leaves empty.
- **The SDK has no workspace dependencies.** The delivered types are copied from `@novan/shared-schemas`, and
  `types.spec.ts` fails if they drift.
- **Checks:** `cms-angular:check-readme` (a dependency of `build`) compiles `libs/cms-angular/examples/` with
  `ngc` and checks the README shows exactly those files. `starter-site:test-bundle` (in CI) builds the starter
  site and fails if `browser/` contains a token variable, a token from the environment, or anything shaped like
  a token.
- **The starter site now provides the SDK and the proxy.** Pages, blocks and cache headers are package 10.
- **Publishing** targets GitHub Packages through `publishConfig`. Open question: GitHub Packages requires the
  npm scope to match the repository owner, so `@novan/cms-angular` cannot be published from the
  `black-isle-beef` account as named. Either create a `novan` organisation or rename the package
  (`@black-isle-beef/cms-angular`) before the first publish.

## Out of scope

Bridge editing behaviour (12), localisation helpers (16).

## Verify

```bash
npx nx test cms-angular       # renderer maps blocks, unknown block handling, rich text XSS cases, transfer state
npx nx build cms-angular
npx nx run starter-site:test-bundle   # no token in the built browser/ output
```

## Definition of done

- [x] No delivery or preview token in any browser bundle (grep the built `browser/` output in a test)
- [x] Rich text renderer passes an XSS test suite (javascript: links, script nodes, event attributes)
- [x] Library builds and its README example compiles
