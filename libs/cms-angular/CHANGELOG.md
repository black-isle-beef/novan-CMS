# Changelog

All notable changes to `@black-isle-beef/cms-angular`. The package follows [semantic versioning](https://semver.org).

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
