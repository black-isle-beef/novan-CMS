# api-search

Full-text search (docs/build/18-search-forms-audit.md).

- `SearchProvider`: the contract the Delivery and Preview APIs (`GET entries?q=`) and the admin's global search use.
  `searchContent` returns ranked entry ids with snippets for one space and environment; `searchSpace` returns pages,
  entries and media for a signed-in person.
- `PostgresSearchProvider`: the implementation, on the search columns of `supabase/migrations/0019_search.sql`
  (`published_content.search`, `entry_search`, `assets.search`, each with a GIN index).
- `SearchController`: `GET /v1/management/spaces/:spaceId/search?q=&environment=main&limit=6`.

To move to a search engine such as Meilisearch, add a provider class that implements `SearchProvider`, keep its index
up to date from the content and media events (or a webhook), and provide it in `SearchModule` instead. The API's
routes and responses stay the same.
