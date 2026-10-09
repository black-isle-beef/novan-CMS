import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseAdmin } from '@novan/api-auth';
import { cacheTag, notFound } from '@novan/api-common';
import { ContentEvents } from '@novan/api-content';
import { assets, blockTypes, contentTypes, DbService, readSpaceLocales } from '@novan/api-db';
import {
  assetUrl,
  type BlockNode,
  type BlockTypeDef,
  type DeliveryAlternate,
  type DeliveryAsset,
  type DeliveryEntriesPage,
  type deliveryEntriesQuerySchema,
  type DeliveryEntry,
  type deliveryEntryQuerySchema,
  type deliveryPageQuerySchema,
  type deliverySingletonQuerySchema,
  type EntryData,
  existsInLocale,
  fallbackChain,
  type FieldDef,
  localisedPath,
  localiseEntryData,
  MEDIA_BUCKET,
  type Sitemap,
  type sitemapQuerySchema,
  type SpaceLocales,
} from '@novan/shared-schemas';
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ApiTokenAccess } from './api-token-resolver';
import { contentSource, type ContentSource, isoTimestamp, publicPath, storedPath } from './content-source';
import { DROP, mapEntryData } from './entry-walker';
import { afterCursor, decodeCursor, encodeCursor, fieldFilterSql, isUuid, orderBy, sortOf } from './query-builder';

type PageQuery = z.output<typeof deliveryPageQuerySchema>;
type EntriesQuery = z.output<typeof deliveryEntriesQuerySchema>;
type EntryQuery = z.output<typeof deliveryEntryQuerySchema>;
type SingletonQuery = z.output<typeof deliverySingletonQuerySchema>;
type SitemapQuery = z.output<typeof sitemapQuerySchema>;

/** A response body and the cache tags of everything in it. */
export interface Delivered<T> {
  body: T;
  tags: string[];
}

export const DELIVERY_CONFIG = Symbol('DELIVERY_CONFIG');

export interface DeliveryConfig {
  /** The API's public address, for asset URLs on the image route (`PUBLIC_API_URL`). */
  publicApiUrl: string;
}

export function deliveryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeliveryConfig {
  return { publicApiUrl: env['PUBLIC_API_URL'] || `http://localhost:${env['API_PORT'] ?? env['PORT'] ?? 3000}` };
}

/** An entry as read from the content source: every locale's values. */
export interface Row {
  id: string;
  contentType: string;
  kind: string;
  /** As stored: `/home` for the home page, no locale prefix. */
  path: string;
  updatedAt: string;
  data: unknown;
}

interface Model {
  types: ReadonlyMap<string, { kind: string; fields: FieldDef[] }>;
  blockTypes: ReadonlyMap<string, BlockTypeDef>;
}

/** The locale a request reads, its fallbacks, and the space's locales for addresses. */
export interface Locale {
  code: string;
  /** The locale, then each fallback in turn. */
  chain: string[];
  defaultLocale: string;
  space: SpaceLocales;
}

interface Expandable {
  include: number;
  select?: string[];
}

/** Entries fetched to resolve references in one response, and entries built into it. */
const MAX_FETCHED = 1000;
const MAX_BUILT = 5000;
const SITEMAP_LIMIT = 50_000;
/** How long a content model or a space's locales are reused; a change reaches delivered responses within this. */
const MODEL_CACHE_MS = 5_000;
/** Preview has no image route (it serves published files only), so it signs Storage URLs for an hour. */
const PREVIEW_URL_SECONDS = 3600;

/**
 * Reads pages and entries for the Delivery API (published copies only) and the Preview API (current
 * drafts), through the service role and always within the token's space and environment. Each response is in one
 * locale (docs/build/16-localisation.md): translated values come from the locale, or along its fallbacks. References
 * are expanded to the requested depth, media items become `DeliveryAsset`s and internal links get the address of
 * the page they point to in that locale.
 */
@Injectable()
export class ContentReader {
  private readonly logger = new Logger(ContentReader.name);
  private readonly models = new Map<string, { model: Promise<Model>; until: number }>();
  private readonly spaceLocales = new Map<string, { locales: Promise<SpaceLocales>; until: number }>();

  constructor(
    private readonly db: DbService,
    private readonly supabase: SupabaseAdmin,
    @Inject(DELIVERY_CONFIG) private readonly config: DeliveryConfig,
    events: ContentEvents,
  ) {
    // This instance forgets a space's locales as soon as they change; others within MODEL_CACHE_MS.
    events.on('locales.changed').subscribe((event) => this.spaceLocales.delete(event.spaceId));
  }

  /** The space's locales, and whether its site shows them in addresses. */
  async locales(access: ApiTokenAccess): Promise<Delivered<SpaceLocales>> {
    return { body: await this.localesOf(access.spaceId), tags: [cacheTag.space(access.spaceId)] };
  }

  /**
   * One page in one locale, by its path without a locale prefix. A page with nothing to show along the locale's
   * fallbacks is not found there.
   */
  async page(access: ApiTokenAccess, query: PageQuery): Promise<Delivered<DeliveryEntry>> {
    const src = this.source(access);
    const [[row], model, locale] = await Promise.all([
      this.db.serviceDb
        .select(columns(src))
        .from(src)
        .where(and(eq(src.kind, 'page'), sql`${src.path} = ${storedPath(query.path)}`))
        .limit(1),
      this.model(access),
      this.locale(access, query.locale),
    ]);
    const fields = row ? (model.types.get(row.contentType)?.fields ?? []) : [];
    const blocks = model.blockTypes;
    if (!row || !existsInLocale(fields, asData(row.data), locale.chain, locale.defaultLocale, blocks)) {
      throw notFound('page_not_found', `There is no ${published(access)}page at ${query.path} in ${locale.code}.`);
    }
    const alternates: DeliveryAlternate[] = locale.space.locales
      .filter((other) =>
        existsInLocale(fields, asData(row.data), fallbackChain(locale.space.locales, other.code), locale.defaultLocale, blocks),
      )
      .map((other) => ({ locale: other.code, path: localisedPath(publicPath(row.path), other.code, locale.space) }));
    const { items, tags } = await this.expand(access, model, locale, [row], query);
    return { body: { ...items[0], alternates }, tags: [cacheTag.space(access.spaceId), ...tags] };
  }

  async entries(access: ApiTokenAccess, query: EntriesQuery): Promise<Delivered<DeliveryEntriesPage>> {
    const src = this.source(access);
    const [model, locale] = await Promise.all([this.model(access), this.locale(access, query.locale)]);
    const fields = query.type ? (model.types.get(query.type)?.fields ?? null) : null;
    if (query.type && !fields) throw notFound('content_type_not_found', `There is no content type "${query.type}".`);

    const sort = sortOf(src, query.sort, fields, query.type, locale);
    const filters: (SQL | undefined)[] = [
      query.type ? eq(src.contentType, query.type) : undefined,
      ...query.filters.map((filter) => fieldFilterSql(src, fields ?? [], query.type ?? '', filter, locale)),
      query.cursor ? afterCursor(src, sort, decodeCursor(query.cursor, sort)) : undefined,
    ];
    const rows = await this.db.serviceDb
      .select({ ...columns(src), sortValue: sql<string | null>`(${sort.expr})::text` })
      .from(src)
      .where(and(...filters))
      .orderBy(...orderBy(src, sort))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > query.limit && last ? encodeCursor({ s: sort.spec, v: last.sortValue, id: last.id }) : null;
    const { items, tags } = await this.expand(access, model, locale, page, query);
    const listTag = query.type ? cacheTag.type(access.environmentId, query.type) : cacheTag.entries(access.environmentId);
    return { body: { items, nextCursor }, tags: [cacheTag.space(access.spaceId), listTag, ...tags] };
  }

  async entry(access: ApiTokenAccess, id: string, query: EntryQuery): Promise<Delivered<DeliveryEntry>> {
    const src = this.source(access);
    const [[row], model, locale] = await Promise.all([
      this.db.serviceDb.select(columns(src)).from(src).where(eq(src.id, id)).limit(1),
      this.model(access),
      this.locale(access, query.locale),
    ]);
    if (!row) throw notFound('entry_not_found', `There is no ${published(access)}entry with this id.`);
    const { items, tags } = await this.expand(access, model, locale, [row], query);
    return { body: items[0], tags: [cacheTag.space(access.spaceId), ...tags] };
  }

  /** The entry of a singleton type (site settings, navigation) in the locale. */
  async singleton(access: ApiTokenAccess, apiId: string, query: SingletonQuery): Promise<Delivered<DeliveryEntry>> {
    const [model, locale] = await Promise.all([this.model(access), this.locale(access, query.locale)]);
    if (model.types.get(apiId)?.kind !== 'singleton') {
      throw notFound('singleton_not_found', `There is no singleton "${apiId}".`);
    }
    const src = this.source(access);
    const [row] = await this.db.serviceDb
      .select(columns(src))
      .from(src)
      .where(eq(src.contentType, apiId))
      .orderBy(desc(src.updatedAt), asc(src.id))
      .limit(1);
    if (!row) throw notFound('singleton_not_found', `"${apiId}" has no ${published(access)}content yet.`);
    const { items, tags } = await this.expand(access, model, locale, [row], query);
    return {
      body: items[0],
      tags: [cacheTag.space(access.spaceId), cacheTag.type(access.environmentId, apiId), ...tags],
    };
  }

  /**
   * Unsaved data of one entry as the Preview API would deliver it, for the visual editor's live preview. The
   * caller has checked that the user may read the entry and validated `row.data` as a draft.
   */
  async render(access: ApiTokenAccess, row: Row, include: number, locale?: string): Promise<DeliveryEntry> {
    const [model, resolved] = await Promise.all([this.model(access), this.locale(access, locale)]);
    const { items } = await this.expand(access, model, resolved, [row], { include });
    return items[0];
  }

  /**
   * Every page's address in each locale it is in, and when it last changed, for a site's sitemap.xml. Pages hidden
   * from search engines (`seo.noindex`, docs/build/14-seo-site-features.md) are left out.
   */
  async sitemap(access: ApiTokenAccess, query: SitemapQuery): Promise<Delivered<Sitemap>> {
    const src = this.source(access);
    const [rows, model, space] = await Promise.all([
      this.db.serviceDb
        .select({ id: src.id, contentType: src.contentType, path: src.path, updatedAt: isoTimestamp(src.updatedAt), data: src.data })
        .from(src)
        .where(and(eq(src.kind, 'page'), sql`(${src.data} #> '{seo,noindex}') is distinct from 'true'::jsonb`))
        .orderBy(asc(src.path))
        .limit(SITEMAP_LIMIT),
      this.model(access),
      this.localesOf(access.spaceId),
    ]);
    const { defaultLocale } = defaults(space);
    const wanted = query.locale ? space.locales.filter((locale) => locale.code === query.locale) : space.locales;
    const items = rows.flatMap((row) => {
      const fields = model.types.get(row.contentType)?.fields ?? [];
      return wanted
        .filter((locale) => existsInLocale(fields, asData(row.data), fallbackChain(space.locales, locale.code), defaultLocale, model.blockTypes))
        .map((locale) => ({
          id: row.id,
          path: localisedPath(publicPath(row.path), locale.code, space),
          locale: locale.code,
          updatedAt: row.updatedAt,
        }));
    });
    return {
      body: { items: items.slice(0, SITEMAP_LIMIT) },
      tags: [cacheTag.space(access.spaceId), cacheTag.sitemap(access.environmentId)],
    };
  }

  private source(access: ApiTokenAccess): ContentSource {
    return contentSource(this.db.serviceDb, access);
  }

  /** The requested locale (the default when none is asked for) and its fallbacks; 404 for one the space lacks. */
  private async locale(access: ApiTokenAccess, requested: string | undefined): Promise<Locale> {
    const space = await this.localesOf(access.spaceId);
    const { defaultLocale } = defaults(space);
    const code = requested ?? defaultLocale;
    if (!space.locales.some((locale) => locale.code === code)) {
      throw notFound('locale_not_found', `This site is not published in ${code}.`);
    }
    return { code, chain: fallbackChain(space.locales, code), defaultLocale, space };
  }

  /** The space's locales, kept for {@link MODEL_CACHE_MS} like the model. */
  private localesOf(spaceId: string): Promise<SpaceLocales> {
    const now = Date.now();
    const cached = this.spaceLocales.get(spaceId);
    if (cached && cached.until > now) return cached.locales;
    const locales = readSpaceLocales(this.db.serviceDb, spaceId);
    this.spaceLocales.set(spaceId, { locales, until: now + MODEL_CACHE_MS });
    locales.catch(() => this.spaceLocales.delete(spaceId));
    return locales;
  }

  /**
   * The environment's content types and block types, kept for {@link MODEL_CACHE_MS}: they change rarely,
   * and reading them for every request would double the queries a delivery request makes.
   */
  private model(access: ApiTokenAccess): Promise<Model> {
    const now = Date.now();
    const cached = this.models.get(access.environmentId);
    if (cached && cached.until > now) return cached.model;
    const model = this.loadModel(access);
    this.models.set(access.environmentId, { model, until: now + MODEL_CACHE_MS });
    model.catch(() => this.models.delete(access.environmentId));
    return model;
  }

  private async loadModel(access: ApiTokenAccess): Promise<Model> {
    const [types, blocks] = await Promise.all([
      this.db.serviceDb
        .select({ apiId: contentTypes.apiId, kind: contentTypes.kind, fields: contentTypes.fields })
        .from(contentTypes)
        .where(and(eq(contentTypes.spaceId, access.spaceId), eq(contentTypes.environmentId, access.environmentId))),
      this.db.serviceDb
        .select({ apiId: blockTypes.apiId, fields: blockTypes.fields, allowedChildren: blockTypes.allowedChildren })
        .from(blockTypes)
        .where(and(eq(blockTypes.spaceId, access.spaceId), eq(blockTypes.environmentId, access.environmentId))),
    ]);
    // `fields` is written only by the content model API (validated) or the seed (tested).
    return {
      types: new Map(types.map((t) => [t.apiId, { kind: t.kind, fields: t.fields as FieldDef[] }])),
      blockTypes: new Map(blocks.map((b) => [b.apiId, { ...b, fields: b.fields as FieldDef[] }])),
    };
  }

  /**
   * Builds the delivered entries in the locale: fetches referenced entries level by level up to `include` (a loop
   * back to an entry being expanded stays `{ id }`), then the files and link targets they use, all in a few
   * queries rather than one per reference.
   */
  private async expand(
    access: ApiTokenAccess,
    model: Model,
    locale: Locale,
    rows: Row[],
    { include, select }: Expandable,
  ): Promise<{ items: DeliveryEntry[]; tags: string[] }> {
    const src = this.source(access);
    const fieldsOf = (row: Row) => model.types.get(row.contentType)?.fields ?? [];
    // Every value as the locale reads it, before anything else looks at the data.
    const localise = (row: Row): Row => ({
      ...row,
      data: localiseEntryData(fieldsOf(row), asData(row.data), locale.chain, locale.defaultLocale, model.blockTypes),
    });
    const top = rows.map((row) => ({ ...row, data: pick(asData(localise(row).data), select) }));
    const known = new Map<string, Row | null>(top.map((row) => [row.id, row]));

    let frontier: Row[] = top;
    for (let level = 0; level < include && known.size < MAX_FETCHED; level++) {
      const wanted = new Set<string>();
      for (const row of frontier) {
        mapEntryData(fieldsOf(row), asData(row.data), model.blockTypes, {
          block: visible,
          reference: (id) => {
            if (isUuid(id) && !known.has(id)) wanted.add(id);
            return id;
          },
        });
      }
      const ids = [...wanted].slice(0, MAX_FETCHED - known.size);
      if (!ids.length) break;
      const found = (await this.db.serviceDb.select(columns(src)).from(src).where(inArray(src.id, ids))).map(localise);
      const byId = new Map(found.map((row) => [row.id, row]));
      for (const id of ids) known.set(id, byId.get(id) ?? null);
      frontier = found;
    }

    // Files and link targets of everything that may be built.
    const assetIds = new Set<string>();
    const linkIds = new Set<string>();
    for (const row of [...top, ...[...known.values()].filter((r): r is Row => r !== null)]) {
      mapEntryData(fieldsOf(row), asData(row.data), model.blockTypes, {
        block: visible,
        media: (item) => {
          if (isUuid(item.assetId)) assetIds.add(item.assetId);
          return item;
        },
        link: (link) => {
          if (link['type'] === 'internal' && typeof link['entryId'] === 'string' && isUuid(link['entryId'])) linkIds.add(link['entryId']);
          return link;
        },
      });
    }
    const [files, paths] = await Promise.all([this.assets(access, assetIds), this.paths(src, known, linkIds)]);
    const sitePath = (path: string) => localisedPath(publicPath(path), locale.code, locale.space);
    const prefixesLinks = localisedPath('/', locale.code, locale.space) !== '/';

    const tags = new Set<string>();
    let budget = MAX_BUILT;
    const build = (row: Row, depth: number, ancestors: ReadonlySet<string>): DeliveryEntry => {
      budget--;
      tags.add(cacheTag.entry(row.id));
      const inside = new Set(ancestors).add(row.id);
      const data = mapEntryData(fieldsOf(row), asData(row.data), model.blockTypes, {
        block: visible,
        reference: (id) => {
          const target = known.get(id);
          if (target === null) return DROP;
          if (!target || depth === 0 || inside.has(id) || budget <= 0) return { id };
          return build(target, depth - 1, inside);
        },
        media: (item) => {
          const file = files.get(item.assetId);
          if (!file) return DROP;
          tags.add(cacheTag.asset(file.id));
          return { ...file, alt: item.alt?.trim() || file.alt };
        },
        link: (link) => {
          if (link['type'] !== 'internal') return link;
          const path = paths.get(String(link['entryId']));
          return { ...link, path: path ? sitePath(path) : null };
        },
        // Links typed into rich text as site addresses (`/contact`) stay in the locale.
        richText: (doc) => (prefixesLinks ? withLinks(doc, (href) => localisedHref(href, locale)) : doc),
      });
      return { id: row.id, contentType: row.contentType, path: sitePath(row.path), locale: locale.code, updatedAt: row.updatedAt, data };
    };

    const items = top.map((row) => build(row, include, new Set()));
    return { items, tags: [...tags] };
  }

  /** Live files of the space, as delivered. */
  private async assets(access: ApiTokenAccess, ids: ReadonlySet<string>): Promise<Map<string, DeliveryAsset>> {
    if (!ids.size) return new Map();
    const rows = await this.db.serviceDb
      .select({
        id: assets.id,
        path: assets.path,
        filename: assets.filename,
        mime: assets.mime,
        width: assets.width,
        height: assets.height,
        alt: assets.alt,
        focalX: assets.focalX,
        focalY: assets.focalY,
        revision: assets.revision,
      })
      .from(assets)
      .where(and(eq(assets.spaceId, access.spaceId), inArray(assets.id, [...ids]), isNull(assets.deletedAt)));

    const signed = access.scope === 'preview' ? await this.signedUrls(rows.map((row) => row.path)) : new Map<string, string>();
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          url: signed.get(row.path) ?? assetUrl(this.config.publicApiUrl, row),
          filename: row.filename,
          mime: row.mime,
          width: row.width,
          height: row.height,
          alt: row.alt,
          focal: row.focalX !== null && row.focalY !== null ? { x: row.focalX, y: row.focalY } : null,
        },
      ]),
    );
  }

  private async signedUrls(paths: string[]): Promise<Map<string, string>> {
    if (!paths.length) return new Map();
    const { data, error } = await this.supabase.storage.from(MEDIA_BUCKET).createSignedUrls(paths, PREVIEW_URL_SECONDS);
    if (error || !data) {
      this.logger.warn(`Could not sign preview file URLs: ${error?.message}`);
      return new Map();
    }
    return new Map(
      data.flatMap((item) => (item.path && item.signedUrl ? [[item.path, item.signedUrl] as [string, string]] : [])),
    );
  }

  /** Stored paths of link targets, from entries already fetched or one more query. */
  private async paths(src: ContentSource, known: ReadonlyMap<string, Row | null>, ids: ReadonlySet<string>): Promise<Map<string, string>> {
    const paths = new Map<string, string>();
    const missing: string[] = [];
    for (const id of ids) {
      const row = known.get(id);
      if (row) paths.set(id, row.path);
      else if (row === undefined) missing.push(id);
    }
    if (missing.length) {
      const rows = await this.db.serviceDb.select({ id: src.id, path: src.path }).from(src).where(inArray(src.id, missing));
      for (const row of rows) paths.set(row.id, row.path);
    }
    return paths;
  }
}

function columns(src: ContentSource) {
  return {
    id: src.id,
    contentType: src.contentType,
    kind: src.kind,
    path: src.path,
    updatedAt: isoTimestamp(src.updatedAt),
    data: src.data,
  };
}

function defaults(space: SpaceLocales): { defaultLocale: string } {
  // Every space has a default locale (0013_localisation.sql).
  return { defaultLocale: space.locales.find((locale) => locale.isDefault)?.code ?? 'en-GB' };
}

/** Hidden blocks stay in the page for its editors but are never delivered. */
const visible = (node: BlockNode): BlockNode | typeof DROP => (node._hidden === true ? DROP : node);

const published = (access: ApiTokenAccess): string => (access.scope === 'delivery' ? 'published ' : '');

function asData(value: unknown): EntryData {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as EntryData) : {};
}

/** A copy of a rich text document with each link mark's `href` replaced. */
function withLinks(node: Record<string, unknown>, map: (href: string) => string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node };
  if (Array.isArray(node['marks'])) {
    out['marks'] = node['marks'].map((mark: unknown) => {
      const attrs = (mark as { type?: unknown; attrs?: Record<string, unknown> } | null)?.attrs;
      return (mark as { type?: unknown })?.type === 'link' && typeof attrs?.['href'] === 'string'
        ? { ...(mark as object), attrs: { ...attrs, href: map(attrs['href']) } }
        : mark;
    });
  }
  if (Array.isArray(node['content'])) {
    out['content'] = node['content'].map((child: unknown) => (typeof child === 'object' && child !== null ? withLinks(child as Record<string, unknown>, map) : child));
  }
  return out;
}

/**
 * A site address (`/contact`, `/contact#form`, `/?q=1`) in the locale, when its addresses carry a prefix. Other links
 * (`https://`, `mailto:`, `#top`, `//host`) and addresses already in the locale are left alone.
 */
function localisedHref(href: string, locale: Locale): string {
  if (!/^\/(?![/\\])/.test(href)) return href;
  const prefix = localisedPath('/', locale.code, locale.space);
  if (href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`) || href.startsWith(`${prefix}#`)) return href;
  const cut = href.search(/[?#]/);
  const path = cut >= 0 ? href.slice(0, cut) : href;
  return `${localisedPath(path, locale.code, locale.space)}${cut >= 0 ? href.slice(cut) : ''}`;
}

/** Only the selected fields, in the order asked for. */
function pick(data: EntryData, select: readonly string[] | undefined): EntryData {
  if (!select) return data;
  return Object.fromEntries(select.filter((key) => key in data).map((key) => [key, data[key]]));
}
