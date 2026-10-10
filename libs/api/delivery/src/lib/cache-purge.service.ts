import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { cacheTag } from '@novan/api-common';
import type { ContentChangedJob, ContentEvent } from '@novan/api-content';
import { DbService, type DbTransaction, readSpaceLocales, spaces } from '@novan/api-db';
import { enqueue, type Job, JobHandlers } from '@novan/api-jobs';
import { localisedPath } from '@novan/shared-schemas';
import type { MediaChangedJob, MediaEvent } from '@novan/api-media';
import { eq } from 'drizzle-orm';
import { overflowTag, tokenTag } from './cache-headers.interceptor';
import { CloudflareClient, PURGE_BATCH } from './cloudflare-client';
import { publicPath } from './content-source';

/** The purge job for a revoked API token. */
export interface TokenRevokedJob extends Job {
  type: 'token-revoked';
  spaceId: string;
  tokenId: string;
}

/**
 * Purges the CDN when published content changes, as jobs on the `purge` queue (libs/api/jobs) sent in the transaction
 * that made the change. On `entry.published` and `entry.unpublished` it purges the entry's tags plus the environment's
 * unfiltered lists and sitemap; on `asset.replaced` and `asset.deleted` the file's tag (responses embedding the file
 * carry it too); on a revoked token, every response that token was given. Purging is by tag; if Cloudflare refuses (a
 * plan without purge by tag), it falls back to purging the page's URL on each of the space's domains
 * (`settings.domains`). Without `CLOUDFLARE_ZONE_ID` (local) it does nothing. A purge that fails is thrown, so the
 * worker retries it with back-off.
 */
@Injectable()
export class CachePurge implements OnModuleInit {
  private readonly logger = new Logger(CachePurge.name);

  constructor(
    private readonly cloudflare: CloudflareClient,
    private readonly db: DbService,
    private readonly jobs: JobHandlers,
  ) {}

  onModuleInit(): void {
    this.jobs.register('purge', 'content-changed', (job) => this.contentChanged((job as ContentChangedJob).event));
    this.jobs.register('purge', 'media-changed', (job) => this.mediaChanged((job as MediaChangedJob).event));
    this.jobs.register('purge', 'token-revoked', (job) => this.tokenRevoked((job as TokenRevokedJob).tokenId));
  }

  /** Queues the purge of everything a revoked token was given, in the revoking transaction. */
  queueTokenRevoked(tx: DbTransaction, spaceId: string, tokenId: string): Promise<void> {
    return enqueue(tx, 'purge', { type: 'token-revoked', spaceId, tokenId } satisfies TokenRevokedJob);
  }

  contentChanged(event: ContentEvent): Promise<void> {
    /** Each page's address in every locale (with its prefix, when the space uses them), and other addresses as they are. */
    const urls = (pages: string[], others: string[] = []) => async () => {
      const [domains, locales] = await Promise.all([this.domains(event.spaceId), readSpaceLocales(this.db.serviceDb, event.spaceId)]);
      const paths = [
        ...new Set([...pages.flatMap((path) => locales.locales.map((locale) => localisedPath(publicPath(path), locale.code, locales))), ...others]),
      ];
      return domains.flatMap((origin) => paths.map((path) => `${origin}${path}`));
    };
    // Publishing and moving can change addresses, and with them the space's redirects (0012_seo_site.sql).
    const redirects = [cacheTag.redirects(event.spaceId), overflowTag(event.spaceId)];
    switch (event.type) {
      case 'redirects.changed':
        return this.purge(`${event.type} ${event.spaceId}`, redirects, urls([], event.paths));
      case 'locales.changed':
        // Every page reads differently: the space's whole cache goes. Without tags, the home page and sitemap at least.
        return this.purge(`${event.type} ${event.spaceId}`, [cacheTag.space(event.spaceId), ...redirects], urls(['/'], ['/sitemap.xml']));
      case 'paths.changed':
        return this.purge(
          `${event.type} ${event.entryIds.join(',')}`,
          [...event.cacheTags, cacheTag.entries(event.environmentId), cacheTag.sitemap(event.environmentId), ...redirects],
          urls(event.paths, ['/sitemap.xml']),
        );
      default:
        return this.purge(
          `${event.type} ${event.entryId}`,
          [...event.cacheTags, cacheTag.entries(event.environmentId), cacheTag.sitemap(event.environmentId), ...redirects],
          urls(event.path ? [event.path] : [], ['/sitemap.xml']),
        );
    }
  }

  mediaChanged(event: MediaEvent): Promise<void> {
    // Which pages show the file is not known here, so there is no URL to fall back to.
    return this.purge(`${event.type} ${event.assetId}`, [...event.cacheTags, overflowTag(event.spaceId)], async () => []);
  }

  tokenRevoked(tokenId: string): Promise<void> {
    return this.purge(`token revoked ${tokenId}`, [tokenTag(tokenId)], async () => []);
  }

  private async purge(what: string, tags: string[], fallbackUrls: () => Promise<string[]>): Promise<void> {
    if (!this.cloudflare.enabled) return;
    const unique = [...new Set(tags)];
    try {
      for (const batch of chunks(unique, PURGE_BATCH)) await this.cloudflare.purgeTags(batch);
      return;
    } catch (error) {
      this.logger.warn(`Purge by tag failed for ${what}: ${String(error)}. Falling back to URLs.`);
    }
    const urls = await fallbackUrls();
    // Thrown so the worker tries again: tag purges can fail for a moment too.
    if (!urls.length) throw new Error(`Could not purge the CDN for ${what}: purge by tag failed and there are no URLs to fall back to`);
    for (const batch of chunks(urls, PURGE_BATCH)) await this.cloudflare.purgeUrls(batch);
  }

  /** The space's site origins from `settings.domains`, e.g. `["https://www.example.com"]`. */
  private async domains(spaceId: string): Promise<string[]> {
    const [space] = await this.db.serviceDb.select({ settings: spaces.settings }).from(spaces).where(eq(spaces.id, spaceId));
    const domains = (space?.settings as { domains?: unknown } | undefined)?.domains;
    if (!Array.isArray(domains)) return [];
    return domains.flatMap((domain) => {
      if (typeof domain !== 'string') return [];
      try {
        const url = new URL(domain);
        return url.protocol === 'https:' || url.protocol === 'http:' ? [url.origin] : [];
      } catch {
        return [];
      }
    });
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
