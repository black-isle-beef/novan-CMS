# api-delivery

The Delivery and Preview APIs client sites read content from, and the API tokens they use (package 08).

| Route | Who | What |
| --- | --- | --- |
| `GET /v1/delivery/pages?path=/about` | delivery token | One published page by path (`/` is the top-level `home` page, no locale prefix) and `locale`, with `alternates` |
| `GET /v1/delivery/entries` | delivery token | `type`, `locale`, `fields.<field>[eq\|in\|lt\|gt]`, `sort`, `limit` ≤ 100, `cursor`, `select`, `include` 0–3 |
| `GET /v1/delivery/entries/:id` | delivery token | One published entry, in `locale` |
| `GET /v1/delivery/singletons/:apiId` | delivery token | A singleton's content (site settings, navigation), in `locale` |
| `GET /v1/delivery/sitemap` | delivery token | Every published page's address and `updatedAt` in each locale it is in, except pages with `seo.noindex` |
| `GET /v1/delivery/locales` | delivery token | The site's locales (default first) and whether addresses carry a locale prefix (package 16) |
| `GET /v1/delivery/redirects` | delivery token | The space's redirects, for the site's server to apply (package 14) |
| `POST /v1/delivery/not-found` | delivery token | A site reports an address with no page: one row per address and day (202); 60 a minute per token |
| `GET /v1/preview/...` | preview token | The same routes and shapes, reading current drafts |
| `GET/POST api-tokens`, `POST api-tokens/:id/revoke` | admins, developers | Under `/v1/management/spaces/:spaceId`; the secret is returned once, on create |

- The space and environment come from the token (`ApiTokenGuard`), never the URL. Tokens are `nv_del_`/`nv_pre_`
  plus 256 random bits; only their SHA-256 is stored. Lookups are cached for 30 seconds; revoking clears this
  instance's cache and purges the token's CDN responses (`token:<id>`).
- `ContentReader` reads through the service role and every query is limited to the token's space and
  environment: delivery from `published_content` only, preview from live entries at their current version.
  References are expanded level by level (one query per level), loops stay `{ id }`, anything unpublished is
  left out; media items become `DeliveryAsset`s (`assetUrl()`; preview signs Storage URLs instead, as the image
  route serves published files only); internal links gain the target's `path`.
- Delivery responses: `Cache-Control: public, max-age=0, s-maxage=31536000, stale-while-revalidate=60`,
  `Cache-Tag` (`token:`, `space:`, `entry:`, `asset:`, `type:<env>:<apiId>`, `entries:<env>`, `sitemap:<env>`), a weak
  `ETag` and `Vary: Authorization`. Preview: `private, no-store`. Errors: `no-store`.
- `CachePurge` purges by tag on `entry.published`/`entry.unpublished` and `MediaEvents`, falling back to the
  page's URL on the space's `settings.domains`; it does nothing without `CLOUDFLARE_ZONE_ID`.
- Rate limits per token (`@nestjs/throttler`, in memory): delivery 50/s, preview 10/s, not-found reports 60/min
  (`NOT_FOUND_RATE_LIMIT`), 429 `rate_limited`.
- `CachePurge` also purges `redirects:<space>` on publishing, `paths.changed` (a published page moved, or a folder above
  it renamed) and `redirects.changed` (redirects managed in `@novan/api-site`), and the whole `space:<id>` on
  `locales.changed`. Its URL fallback purges each page's address in every locale.
- Locales (package 16, docs/build/16-localisation.md): every response is in one locale, the `locale` parameter or the
  space's default (404 `locale_not_found` for one the space lacks). Data is read with `localiseEntryData` before
  anything else: each translated value comes from the locale, then along its fallbacks. A page with nothing to show
  along the chain is 404 `page_not_found` in that locale; `alternates` lists the locales it is in, the default first.
  Filters and sorting on a translated field read it along the same chain in SQL. With locale prefixes on
  (`spaces.locale_prefixes`), delivered paths, internal links, site addresses in rich text and alternates are the
  site's addresses in the locale (`/fr/about`); `pages?path=` always takes the path without a prefix.

Run `nx test api-delivery` (purge, tokens, walker) and `nx test api` (HTTP and database, including the
cross-space token test); `nx e2e api-e2e` publishes through the API and checks the purge a fake Cloudflare
receives.
