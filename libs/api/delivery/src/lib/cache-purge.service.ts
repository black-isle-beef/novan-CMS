import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { cacheTag } from '@novan/api-common';
import { type ContentEvent, ContentEvents } from '@novan/api-content';
import { DbService, spaces } from '@novan/api-db';
import { type MediaEvent, MediaEvents } from '@novan/api-media';
import { eq } from 'drizzle-orm';
import type { Subscription } from 'rxjs';
import { overflowTag, tokenTag } from './cache-headers.interceptor';
import { CloudflareClient, PURGE_BATCH } from './cloudflare-client';
import { publicPath } from './content-source';

/**
 * Purges the CDN when published content changes. On `entry.published` and `entry.unpublished` it purges
 * the entry's tags plus the environment's unfiltered lists and sitemap; on `asset.replaced` and
 * `asset.deleted` the file's tag (responses embedding the file carry it too); on a revoked token, every
 * response that token was given. Purging is by tag; if Cloudflare refuses (a plan without purge by tag),
 * it falls back to purging the page's URL on each of the space's domains (`settings.domains`). Without
 * `CLOUDFLARE_ZONE_ID` (local) it does nothing. Failures are logged, never raised: the content change has
 * already happened.
 */
@Injectable()
export class CachePurge implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CachePurge.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly cloudflare: CloudflareClient,
    private readonly content: ContentEvents,
    private readonly media: MediaEvents,
    private readonly db: DbService,
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.content.events$.subscribe((event) => void this.contentChanged(event)),
      this.media.events$.subscribe((event) => void this.mediaChanged(event)),
    );
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
  }

  contentChanged(event: ContentEvent): Promise<void> {
    const urls = (paths: string[]) => async () => {
      const domains = await this.domains(event.spaceId);
      return domains.flatMap((origin) => paths.map((path) => `${origin}${path}`));
    };
    // Publishing and moving can change addresses, and with them the space's redirects (0012_seo_site.sql).
    const redirects = [cacheTag.redirects(event.spaceId), overflowTag(event.spaceId)];
    switch (event.type) {
      case 'redirects.changed':
        return this.purge(`${event.type} ${event.spaceId}`, redirects, urls(event.paths));
      case 'paths.changed':
        return this.purge(
          `${event.type} ${event.entryIds.join(',')}`,
          [...event.cacheTags, cacheTag.entries(event.environmentId), cacheTag.sitemap(event.environmentId), ...redirects],
          urls([...new Set([...event.paths.map(publicPath), '/sitemap.xml'])]),
        );
      default:
        return this.purge(
          `${event.type} ${event.entryId}`,
          [...event.cacheTags, cacheTag.entries(event.environmentId), cacheTag.sitemap(event.environmentId), ...redirects],
          urls(event.path ? [publicPath(event.path), '/sitemap.xml'] : ['/sitemap.xml']),
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
    try {
      const urls = await fallbackUrls();
      if (!urls.length) {
        this.logger.error(`Could not purge the CDN for ${what}: no URLs to fall back to. Cached copies stay until they expire.`);
        return;
      }
      for (const batch of chunks(urls, PURGE_BATCH)) await this.cloudflare.purgeUrls(batch);
    } catch (error) {
      this.logger.error(`Could not purge the CDN for ${what}: ${String(error)}`);
    }
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
