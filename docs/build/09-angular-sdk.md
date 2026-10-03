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

## Out of scope

Bridge editing behaviour (12), localisation helpers (16).

## Verify

```bash
npx nx test cms-angular       # renderer maps blocks, unknown block handling, rich text XSS cases, transfer state
npx nx build cms-angular
```

## Definition of done

- [ ] No delivery or preview token in any browser bundle (grep the built `browser/` output in a test)
- [ ] Rich text renderer passes an XSS test suite (javascript: links, script nodes, event attributes)
- [ ] Library builds and its README example compiles
