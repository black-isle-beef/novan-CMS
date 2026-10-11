import { Injectable } from '@nestjs/common';
import { notFound } from '@novan/api-common';
import { type Database, DbService, type DbTransaction, environments, type JwtClaims } from '@novan/api-db';
import {
  type AdminSearchHit,
  type AdminSearchResults,
  sitePath,
  SNIPPET_START,
  SNIPPET_STOP,
  snippetParts,
  tsQueryOf,
} from '@novan/shared-schemas';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { ContentSearchRequest, ContentSearchResult, SearchProvider, SpaceSearchRequest } from './search-provider';

/** How snippets are cut: two short passages around the matches, the matching words marked. */
const HEADLINE_OPTIONS =
  `StartSel="${SNIPPET_START}", StopSel="${SNIPPET_STOP}", MaxWords=30, MinWords=12, ShortWord=3, ` +
  `MaxFragments=2, FragmentDelimiter=" … "`;

const query = (tsQuery: string): SQL => sql`to_tsquery('pg_catalog.english', ${tsQuery})`;
const textArray = (values: readonly string[]): SQL => sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
const uuidArray = (values: readonly string[]): SQL => sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::uuid[]`;

/** The text snippets come from: everything but the title (shown beside the snippet) and the address. */
const snippetText = (data: SQL, locales: readonly string[]): SQL =>
  sql`coalesce(
    nullif(public.search_text(${data} - array['title', 'name', 'slug', 'seo'], ${textArray(locales)}), ''),
    public.search_text(${data} -> 'seo', ${textArray(locales)})
  )`;

/**
 * Searches with Postgres full text (0019_search.sql): `published_content.search` for delivery, `entry_search` for
 * drafts and the admin, `assets.search` for media. Matches use the GIN indexes; ranking is `ts_rank` (the title counts
 * most). Delivery and preview searches run on the API's own connection, always within the token's space and
 * environment; the admin's run as the person under RLS.
 */
@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  constructor(private readonly db: DbService) {}

  async searchContent(request: ContentSearchRequest): Promise<ContentSearchResult> {
    const tsQuery = tsQueryOf(request.q);
    if (!tsQuery) return { hits: [], hasMore: false };
    const q = query(tsQuery);
    const matches =
      request.scope === 'delivery'
        ? sql`select pc.entry_id as id, ts_rank(pc.search, ${q}) as rank
            from public.published_content pc
            where pc.space_id = ${request.spaceId} and pc.environment_id = ${request.environmentId} and pc.search @@ ${q}
              ${request.type ? sql`and pc.content_type_api_id = ${request.type}` : sql``}`
        : sql`select s.entry_id as id, ts_rank(s.search, ${q}) as rank
            from public.entry_search s
            join public.entries e on e.id = s.entry_id and e.deleted_at is null
            join public.content_types ct on ct.id = e.content_type_id
            where s.space_id = ${request.spaceId} and s.environment_id = ${request.environmentId} and s.search @@ ${q}
              ${request.type ? sql`and ct.api_id = ${request.type}` : sql``}`;
    const after = request.after
      ? sql`where m.rank < ${request.after.rank}::real or (m.rank = ${request.after.rank}::real and m.id < ${request.after.id}::uuid)`
      : sql``;
    const rows = await this.db.serviceDb.execute<{ id: string; rank: number }>(
      sql`select m.id, m.rank from (${matches}) m ${after} order by m.rank desc, m.id desc limit ${request.limit + 1}`,
    );
    const page = rows.slice(0, request.limit);
    const snippets = await this.snippets(this.db.serviceDb, request, page.map((row) => row.id), q);
    return {
      hits: page.map((row) => ({ id: row.id, rank: Number(row.rank), snippet: snippets.get(row.id) ?? [] })),
      hasMore: rows.length > request.limit,
    };
  }

  searchSpace(claims: JwtClaims | null, request: SpaceSearchRequest): Promise<AdminSearchResults> {
    const tsQuery = tsQueryOf(request.q);
    return this.db.userDb(claims, async (tx) => {
      const [env] = await tx
        .select({ id: environments.id })
        .from(environments)
        .where(and(eq(environments.spaceId, request.spaceId), eq(environments.name, request.environment)));
      if (!env) throw notFound('environment_not_found', `This space has no "${request.environment}" environment.`);
      if (!tsQuery) return { pages: [], entries: [], media: [] };
      const q = query(tsQuery);
      const [pages, entries, media] = [
        await this.entries(tx, request, env.id, q, true),
        await this.entries(tx, request, env.id, q, false),
        await this.media(tx, request, q),
      ];
      return { pages, entries, media };
    });
  }

  /** Snippets of the hits, from the locale's text. */
  private async snippets(db: Database, request: ContentSearchRequest, ids: string[], q: SQL) {
    if (!ids.length) return new Map<string, ReturnType<typeof snippetParts>>();
    const rows =
      request.scope === 'delivery'
        ? await db.execute<{ id: string; headline: string }>(
            sql`select pc.entry_id as id, ts_headline('pg_catalog.english', ${snippetText(sql`pc.data`, request.locales)}, ${q}, ${HEADLINE_OPTIONS}) as headline
              from public.published_content pc
              where pc.space_id = ${request.spaceId} and pc.entry_id = any(${uuidArray(ids)})`,
          )
        : await db.execute<{ id: string; headline: string }>(
            sql`select e.id, ts_headline('pg_catalog.english', ${snippetText(sql`v.data`, request.locales)}, ${q}, ${HEADLINE_OPTIONS}) as headline
              from public.entries e
              join public.entry_versions v on v.id = e.current_version_id
              where e.space_id = ${request.spaceId} and e.id = any(${uuidArray(ids)})`,
          );
    return new Map(rows.map((row) => [row.id, snippetParts(row.headline ?? '')]));
  }

  private async entries(tx: DbTransaction, request: SpaceSearchRequest, environmentId: string, q: SQL, pages: boolean): Promise<AdminSearchHit[]> {
    const rows = await tx.execute<{ id: string; title: string; status: string; type_name: string; path: string }>(
      sql`select s.entry_id as id, s.title, e.status, ct.name as type_name, coalesce(f.path, '') || '/' || e.slug as path
        from public.entry_search s
        join public.entries e on e.id = s.entry_id and e.deleted_at is null
        join public.content_types ct on ct.id = e.content_type_id
        left join public.folders f on f.id = e.folder_id
        where s.space_id = ${request.spaceId} and s.environment_id = ${environmentId} and s.search @@ ${q}
          and ${pages ? sql`ct.kind = 'page'` : sql`ct.kind <> 'page'`}
        order by ts_rank(s.search, ${q}) desc, s.title, s.entry_id
        limit ${request.limit}`,
    );
    return rows.map((row) => ({
      kind: pages ? 'page' : 'entry',
      id: row.id,
      title: row.title,
      detail: pages ? sitePath(row.path) : row.type_name,
      status: row.status,
    }));
  }

  private async media(tx: DbTransaction, request: SpaceSearchRequest, q: SQL): Promise<AdminSearchHit[]> {
    const rows = await tx.execute<{ id: string; title: string | null; filename: string }>(
      sql`select a.id, nullif(btrim(a.title), '') as title, a.filename
        from public.assets a
        where a.space_id = ${request.spaceId} and a.deleted_at is null and a.search @@ ${q}
        order by ts_rank(a.search, ${q}) desc, a.created_at desc, a.id
        limit ${request.limit}`,
    );
    return rows.map((row) => ({ kind: 'media', id: row.id, title: row.title ?? row.filename, detail: row.filename, status: null }));
  }
}
