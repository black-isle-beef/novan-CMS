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

Run `nx test api-content-model` (pure model checks) and `nx test api` (HTTP and database).
