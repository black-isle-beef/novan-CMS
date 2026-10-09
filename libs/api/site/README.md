# api-site

Redirects and the addresses visitors found no page at (package 14), under `/v1/management/spaces/:spaceId`.

| Route | Who | What |
| --- | --- | --- |
| `GET redirects` | members | Every redirect, by address; `automatic` ones were made when a published page's address changed |
| `POST redirects` | editors and up | 409 `redirect_exists`, `redirect_hides_page` (a published page is there) or `redirect_loop` |
| `POST redirects/import` | editors and up | Up to 5000 redirects parsed from a CSV in the admin; same addresses are replaced, live pages skipped |
| `PATCH/DELETE redirects/:id` | editors and up | |
| `GET not-found?days=30&limit=50` | members | Addresses with no page, most visited first; ones that now redirect are left out |

- Every query runs as the caller (`DbService.userDb`), so RLS applies (0012_seo_site.sql), and every change is
  audited (`redirect.created`, `redirect.updated`, `redirect.deleted`, `redirects.imported`).
- Changes are announced as `redirects.changed` on `ContentEvents`; `@novan/api-delivery` purges the CDN's
  `redirects:<spaceId>` tag.
- The database writes the automatic 301s itself, when `published_content.full_path` changes; client sites read
  redirects from `GET /v1/delivery/redirects` and report misses to `POST /v1/delivery/not-found`
  (`@novan/api-delivery`).

Run `nx test api` (`apps/api/src/app/site.spec.ts`, against the local database).