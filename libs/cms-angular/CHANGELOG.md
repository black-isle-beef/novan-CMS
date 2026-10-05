# Changelog

All notable changes to `@black-isle-beef/cms-angular`. The package follows [semantic versioning](https://semver.org).

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
