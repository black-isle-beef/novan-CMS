# api-content-model

Content types and block types (package 05), under
`/v1/management/spaces/:spaceId/environments/:env/content-types` and `.../block-types`
(`GET` list, `GET :apiId`, `POST`, `PATCH :apiId`, `DELETE :apiId`).

- Members read the model; admins, developers and agency staff change it (`@RequireRole` and RLS agree).
- Bodies are validated with the Zod schemas in `@novan/shared-schemas` (`content-model.ts`, `fields.ts`).
  Fields that point at other types (`allowedBlocks`, `contentTypes`, `allowedChildren`) must name types
  that exist in the environment (400 `unknown_reference`), and a type still referenced elsewhere cannot be
  deleted (409 `content_type_in_use` / `block_type_in_use`).
- A change that would make existing entries invalid answers 409 `entries_invalidated` with
  `affectedEntries`, unless sent with `?force=true`. Entries are read through the `ENTRY_SOURCE`
  provider (`DbEntrySource`: each live entry's current version, under the caller's RLS). Forcing the
  deletion of a content type deletes its entries (package 06).
- Every write records an audit event in the same transaction.
- `POST /v1/management/spaces/:spaceId/schema-source/github` (agency staff only) reads a repo's schema files
  (`{ repoUrl, ref?, path = "novan/schema" }`) at one commit from api.github.com with `SCHEMA_GITHUB_TOKEN`, parses
  them with `@novan/schema-sync` and answers them (`repo_not_found`, `ref_not_found`, `schema_not_found` 404;
  `schema_invalid` 422; `github_unavailable` 502). It only reads and records `schema.github_read`; the admin pushes
  the changes through the routes above.

Run `nx test api-content-model` (pure model checks) and `nx test api` (HTTP and database).
