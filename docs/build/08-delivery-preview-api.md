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

## Out of scope

GraphQL (phase 4), full-text search parameter (18).

## Verify

```bash
npx nx test api            # filters, pagination, reference depth, token isolation, cache headers
npx nx e2e api-e2e         # publish via management API -> delivery returns new content; purge called with expected tags
autocannon -c 50 -d 20 http://localhost:3000/v1/delivery/pages?path=/   # p95 < 100 ms locally without CDN
```

## Definition of done

- [ ] Delivery never reads draft data; preview never cached
- [ ] Cross-space token test passes
- [ ] Purge-on-publish wired and unit-tested with a mocked Cloudflare client
