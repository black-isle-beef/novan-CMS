# Changelog

All notable changes to `@black-isle-beef/cms-angular`. The package follows [semantic versioning](https://semver.org).

## 0.8.0 (unreleased)

Class overrides on block parts (docs/build/24-design-systems.md).

- `NovanBlockNode._overrides`: classes per part and bucket, and token overrides, set by editors.
- `NovanPart` (`[data-novan-part]`) and `NovanBlockRoot` (host directive) apply them; `NovanBlockContext` has `parts`
  and `tokens`, kept current as the page changes in the visual editor.
- `NOVAN_CLASS_ADAPTER`, `mergeOverrides`, `overrideTokens`, `createTemplateAdapter`, `plainAdapter`,
  `cascadeLayers`, `CASCADE_LAYERS`, `PART_NAME`, `ROOT_PART` and their types.
- Bridge: site → admin `parts` (the selected block's parts), admin → site `part` (outline one part).
- Sites should wrap their own CSS in `@layer novan-base` (see the README), or editors' classes may lose to it.
- `NovanDesignSystems` and `NovanContentService.siteStyles()` (`GET site-styles`): `provideNovanCms` links the
  stylesheets of the site's attached design systems in `<head>` before the first render and uses the first one's
  class adapter (`designSystems: false` to opt out). `NOVAN_CLASS_ADAPTER` now provides a getter.
- `bootstrapAdapter`, `adapterFor`, `ClassAdapter.canWrite`; type `NovanSiteStyles`. `createNovanProxy` passes
  `site-styles`.

## 0.7.0

Search and forms (docs/build/18-search-forms-audit.md).

- `entries({ q })`: full-text search of the Delivery and Preview APIs, best match first; each entry has
  `search: { rank, snippet }` (types `NovanSearchInfo`, `NovanSnippetPart`).
- `<novan-search>` (`NovanSearch`): an accessible search box and results list with highlighted snippets.
- `NovanForms`: sends form answers (`POST /v1/delivery/forms/:formUid/submit`) from the browser; Cloudflare Turnstile's
  site key from `provideNovanCmsServer({ turnstileSiteKey })` (or `provideNovanCms`) reaches the browser with the page.
- `<novan-blocks [entryId]>` and `NOVAN_BLOCK_CONTEXT`: a block learns its `uid`, block type and page.
- `NovanApiError.errors`: the API's messages by field.
- `createNovanProxy` passes form submissions (POST, JSON, up to 64 KB) with the visitor's address.

## 0.6.0

Languages (docs/build/16-localisation.md).

- `novanPageResolver` reads the locale from the address when the site puts it there (`/fr/about`), through the new
  `novanResolveLocale` and `NovanContentService.locales()` (`GET /v1/delivery/locales`); `NovanLocale.current` holds it
  and later calls ask in it. `novanLocaleOfPath` splits an address into locale and path.
- `applyNovanSeo` sets `<html lang>`, `hreflang` and `x-default` links from `page.alternates`, and
  `og:locale:alternate`; `applyNovanLang` sets `lang` alone. `novanBreadcrumbTrail` starts from the locale's home page.
- `entry(id)` takes `locale` (an entry now holds every locale). Sitemap items have the page's `id`.
- Types: `NovanEntry.alternates`, `NovanAlternate`, `NovanLocale`, `NovanLocales`.
- `createNovanProxy` passes `locales` through.
- Breaking: `provideNovanCms({ locale })` now pins every call to that locale and skips reading it from addresses;
  leave it out for a site in every language of its space.

## 0.5.0

SEO and site features (docs/build/14-seo-site-features.md).

- `createNovanRedirects` (`@black-isle-beef/cms-angular/server`): applies the CMS's redirects
  (`GET /v1/delivery/redirects`) in the site's server before rendering, cached briefly in memory and at the edge.
- `createNovanNotFoundReporter`: reports addresses with no page to `POST /v1/delivery/not-found`.
- Structured data: `novanOrganizationJsonLd`, `novanBreadcrumbTrail`, `novanBreadcrumbJsonLd` and
  `applyNovanJsonLd`.
- `applyNovanSeo` takes `defaultImage`, the site's sharing image, for pages without `seo.ogImage`.
- Types: `NovanSiteSettings`, `NovanRedirect`, `NovanRedirects`; `NovanSeoFields` documents `canonical` and
  `ogImage`, which the seeded `page` type now has.
## 0.4.0

Editing on the page (docs/build/12-visual-editor.md, 12b).

- The bridge draws "+" buttons above and below the block under the pointer, which ask the admin to add a block
  there, and lets editors change a selected block's plain text fields in place with a double-click. A component
  can mark the element showing a field with `data-novan-field="<field>"`; otherwise the bridge finds the element
  whose text is the field's value. Both appear only once the admin says the editor may change the page.
- `<novan-blocks>` leaves out blocks an editor hid (`_hidden: true`); `NovanBlockNode` has `_hidden`. The API
  leaves them out of delivered content as well.

## 0.3.0

The visual editor bridge (docs/build/12-visual-editor.md).

- `createNovanPreviewVerifier` (`@black-isle-beef/cms-angular/server`): a `verifyPreview` that checks the admin's
  signed preview tokens with the Preview API (`GET /v1/preview/session`).
- **Breaking:** `verifyPreview` may answer with the session (`NovanPreviewSession`) as well as `true`/`false`;
  only a session starts the visual editor bridge. `NovanBridgeModule.startNovanBridge` takes a `NovanBridgeHost`
  and returns a `NovanBridgeHandle`.
- The bridge (`@black-isle-beef/cms-angular/bridge`) outlines blocks, reports clicks, hovers and block positions to
  the admin, and applies its updates and refreshed tokens. It talks only to the admin's origin.
- `NovanPreview.withLiveData(page)` shows the editor's unsaved changes for the page being edited.
- In preview mode `<novan-blocks>` wraps each block in `<div data-novan-uid data-novan-block>`, and pages are
  served with `Content-Security-Policy: frame-ancestors 'self' <admin origin>`.

## 0.2.0

- `<novan-blocks>` gives a block component with a `settings` input the block's style options (`_style`, added to
  block data in docs/build/10-blocks-starter-site.md), or `null` when it has none. `NovanBlockNode` has `_style`.

## 0.1.0

First release (docs/build/09-angular-sdk.md).

- `provideNovanCms` and `provideNovanCmsServer`: the API address, locale and blocks for the app, and tokens for
  the server only.
- `NovanContentService`: `page`, `entries`, `entry`, `singleton` and `sitemap` from the Delivery API (Preview API
  in preview mode), with server answers passed to the browser in transfer state.
- `createNovanProxy` (`@black-isle-beef/cms-angular/server`): lets the browser read content through the site's server,
  which adds the token.
- `<novan-blocks>`, `defineBlocks` and the `NovanBlock<TFields>` contract for block components.
- `<novan-rich-text>`: rich text rendered without `innerHTML`, with unsafe links, images, elements and
  attributes dropped.
- `novanImage`, `novanLinkHref`, `novanPageResolver` and `applyNovanSeo`.
- Preview mode from `?novan_preview=<signed token>`, checked on the server by `verifyPreview`: drafts, no caching,
  and the lazy-loaded editor bridge (`@black-isle-beef/cms-angular/bridge`, filled in by package 12).
