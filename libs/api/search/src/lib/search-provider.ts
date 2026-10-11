import type { JwtClaims } from '@novan/api-db';
import type { AdminSearchResults, SearchSnippetPart } from '@novan/shared-schemas';

/** A Delivery or Preview API search (`GET entries?q=`), within one space and environment. */
export interface ContentSearchRequest {
  /** Delivery searches published content; preview, the current drafts of entries not in the bin. */
  scope: 'delivery' | 'preview';
  spaceId: string;
  environmentId: string;
  q: string;
  /** The requested locale, then its fallbacks: snippets are cut from this text. */
  locales: readonly string[];
  /** Only entries of this content type. */
  type?: string;
  limit: number;
  /** Continue after this hit (the last of the previous page). */
  after?: { rank: number; id: string } | null;
}

export interface ContentSearchHit {
  id: string;
  /** Higher is better; only comparable within one search. */
  rank: number;
  snippet: SearchSnippetPart[];
}

export interface ContentSearchResult {
  /** Best first; at most `limit`. */
  hits: ContentSearchHit[];
  /** Whether more hits follow the last one. */
  hasMore: boolean;
}

/** The admin's global search (Ctrl+K) in one space and environment. */
export interface SpaceSearchRequest {
  spaceId: string;
  /** The environment's name, e.g. `main`. */
  environment: string;
  q: string;
  /** Results of each kind. */
  limit: number;
}

/**
 * Full-text search behind the Delivery and Preview APIs' `q` and the admin's global search
 * (docs/build/18-search-forms-audit.md). {@link PostgresSearchProvider} searches the database (0019_search.sql); a
 * search engine such as Meilisearch can replace it by providing this class, without any change to the APIs.
 *
 * `searchSpace` is asked on behalf of a signed-in person: an implementation returns only what their claims allow (the
 * Postgres one reads under row-level security; another would check the space membership the API has already checked).
 */
export abstract class SearchProvider {
  abstract searchContent(request: ContentSearchRequest): Promise<ContentSearchResult>;
  abstract searchSpace(claims: JwtClaims | null, request: SpaceSearchRequest): Promise<AdminSearchResults>;
}
