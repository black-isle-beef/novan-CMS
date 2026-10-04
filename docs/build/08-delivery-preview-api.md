# 08 — Delivery and Preview APIs

**Phase:** 1 Headless core · **Estimate:** 4 days · **Prerequisites:** 06, 07

## Goal

Client sites fetch published content fast through a cacheable Delivery API and fetch drafts through a token-protected Preview API.

## Data

Migration `0008_api_tokens.sql`: `api_tokens (id, space_id, environment_id, name, scope text check in ('delivery','preview'), token_hash, last_used_at, created_by, created_at, revoked_at)`. Tokens are shown once, stored as SHA-256 hashes, prefixed `nv_del_` / `nv_pre_`.

## Endpoints (`libs/api/delivery`)

All require `Authorization: Bearer <token>`; the space and environment come from the token, never from the URL.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/v1/delivery/pages?path=/about` | One page by full path + `locale` |
| GET | `/v1/delivery/entries` | Filter `type`, `fields.<x>[eq|in|lt|gt]`, `sort`, `limit` ≤ 100, `cursor`, `select`, `include` (reference depth 0–3) |
| GET | `/v1/delivery/entries/:id` | |
| GET | `/v1/delivery/singletons/:apiId` | e.g. site settings, navigation |
| GET | `/v1/delivery/sitemap` | paths + `updatedAt` for sitemap generation |
| GET | `/v1/preview/...` | Same shapes, reading `current_version_id` drafts |

## Tasks

1. Token management endpoints and an admin Settings → API tokens screen (developer/admin only).
2. Delivery reads use `serviceDb` against `published_content` only, always filtered by the token's space and environment. Write a test that a token for space A can never return space B content, even with crafted filters.
3. Reference resolution with depth limit and cycle protection; asset objects expanded inline as `DeliveryAsset` with `assetUrl()` from `@novan/shared-schemas` (the API image route, see 07's decisions); purge `asset:<id>` tags on `MediaEvents`.
4. Caching headers on delivery responses: `Cache-Control: public, max-age=0, s-maxage=31536000, stale-while-revalidate=60` plus `Cache-Tag: space:<id>,entry:<id>,type:<apiId>` and an `ETag`. Preview responses: `Cache-Control: private, no-store`.
5. Cache purge service: on `entry.published`/`unpublished`, compute tags and call the Cloudflare purge API (by tag; fall back to purge by URL using the space's configured domains). No-op when `CLOUDFLARE_ZONE_ID` is unset (local).
6. Rate limiting per token (`@nestjs/throttler` backed by Postgres or memory for now): delivery 50 req/s, preview 10 req/s.
7. OpenAPI document generated from the Zod DTOs, served at `/v1/docs` (management + delivery).

## Decisions made during this package

- **The CDN's cache key must include the `Authorization` header.** The token, not the URL, decides the space,
  so `GET /v1/delivery/pages?path=/about` is a different response for every space. Responses carry
  `Vary: Authorization`, but Cloudflare ignores `Vary`; the zone needs a cache rule whose cache key includes
  the `Authorization` header (or the API must not be cached by the CDN) before delivery traffic goes through
  it. Deployment (20) must set this up and test it with two spaces' tokens.
- **Cache tags are scoped to the environment where names are not unique**, because one zone serves every
  space: `space:<id>`, `entry:<id>`, `asset:<id>`, `token:<id>`, `type:<environment_id>:<apiId>`,
  `entries:<environment_id>` (lists not filtered by type) and `sitemap:<environment_id>`. `path:` tags were
  dropped: 404s are never cached, and a moved page's old address is tagged with its entry. A response whose
  tags exceed 15 KB keeps the first that fit plus `overflow:<space_id>`, purged on every change in the space.
  `0008` rewrites the tags 06 stored in `published_content`.
- **Publish and unpublish purge** the entry's tags plus `entries:` and `sitemap:` of its environment;
  `asset.replaced`/`asset.deleted` purge `asset:<id>`; revoking a token purges `token:<id>`. If purge by tag is
  refused, the fallback purges the page's URL and `/sitemap.xml` on each origin in the space's
  `settings.domains` (for example `["https://www.example.com"]`); media events have no URL fallback.
- **Errors are never cached** (`Cache-Control: no-store` from the token guard on; only a successful response
  gets the delivery or preview header). `ETag` is Express's weak ETag; `If-None-Match` answers 304.
- **The home page is the top-level page with slug `home`.** `pages?path=/` finds it, and it is delivered (and
  listed in the sitemap) with `path: "/"`.
- **Delivered entries** are `{ id, contentType, path, locale, updatedAt, data }`. `updatedAt` is when the
  version went live (delivery) or was last saved (preview). In `data`, references are expanded to
  `DeliveryEntry` up to `include` (default 1); deeper, or back to an entry already being expanded, they stay
  `{ id }`; references to unpublished entries (preview: entries in the bin) are left out. Internal links gain
  the target's `path` (null when it is not published). Media items become `DeliveryAsset`s; files in the bin
  are left out.
- **Preview file URLs are signed Storage URLs** (one hour), because the image route serves published files
  only. Resize options do not apply to them.
- **Field filters need `type`** so the field's definition is known: `eq` and `in` on text, number, date,
  boolean, select and reference fields (multi-value select and reference fields match any of their values);
  `lt` and `gt` on text, number and date. `sort` is `updatedAt`, `path` or `fields.<field>`, `-` for
  descending, empty values last. Pagination is keyset (`nextCursor`), so pages do not shift as content is
  published.
- **Tokens** are `nv_del_`/`nv_pre_` plus 256 random bits in base64url, stored as SHA-256 with a hint
  (`nv_del_…a1b2`). Admins, developers and agency staff manage them (`/v1/management/spaces/:spaceId/api-tokens`);
  they are revoked, never deleted. Lookups are cached for 30 seconds per API instance; `last_used_at` is
  written at most once a minute. A delivery token is refused by the Preview API and the other way round.
- **Rate limits** are per token across all routes of its API, in memory per API instance; `DELIVERY_RATE_LIMIT`
  and `PREVIEW_RATE_LIMIT` override 50 and 10 (load tests only). The Verify `autocannon` run needs a token
  header and a raised limit, otherwise it measures 429s.
- **The content model is cached for 5 seconds per environment** in the reader; a change to it reaches
  delivered responses within that.
- **OpenAPI** is generated at runtime from the routes: request schemas from each route's `ZodValidationPipe`,
  responses from `@ApiResponse(schema)`. Management routes without `@ApiResponse` are documented without a
  response body for now. `/v1/docs` serves the OpenAPI 3.1 JSON.
- **Admin:** a **Settings** link (admins, developers, agency staff) opens **API tokens**.
- **e2e purge check:** `api-e2e` starts a fake Cloudflare API and checks the purges it receives when the API was
  started with `CLOUDFLARE_ZONE_ID=e2e-zone CLOUDFLARE_API_TOKEN=e2e-token
  CLOUDFLARE_API_URL=http://127.0.0.1:54399/client/v4`, as CI's e2e step sets them; otherwise that one test is
  skipped. Both e2e projects share the one `api:serve` task: a second API target competes for port 3000 and
  breaks Playwright's web server in CI.
- CORS on the Delivery API is unchanged (admin origin only); the SDK (09) decides whether browsers call it.

## Out of scope

GraphQL (phase 4), full-text search parameter (18).

## Verify

```bash
npx nx test api            # filters, pagination, reference depth, token isolation, cache headers
npx nx e2e api-e2e         # publish via management API -> delivery returns new content; purge called with expected tags
autocannon -c 50 -d 20 http://localhost:3000/v1/delivery/pages?path=/   # p95 < 100 ms locally without CDN
```

## Definition of done

- [x] Delivery never reads draft data; preview never cached
- [x] Cross-space token test passes
- [x] Purge-on-publish wired and unit-tested with a mocked Cloudflare client
