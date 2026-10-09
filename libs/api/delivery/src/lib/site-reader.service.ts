import { Injectable } from '@nestjs/common';
import { cacheTag } from '@novan/api-common';
import { DbService, redirects } from '@novan/api-db';
import type { DeliveryRedirects, RedirectStatus } from '@novan/shared-schemas';
import { asc, eq, sql } from 'drizzle-orm';
import type { ApiTokenAccess } from './api-token-resolver';
import type { Delivered } from './content-reader.service';

/** A space keeps at most this many redirects in one response; more is a sign something is wrong. */
const REDIRECTS_LIMIT = 50_000;

/**
 * What client sites' servers need besides content (docs/build/14-seo-site-features.md): the space's redirects, to
 * apply before rendering, and somewhere to report addresses with no page. Through the service role, always for the
 * token's space only.
 */
@Injectable()
export class SiteReader {
  constructor(private readonly db: DbService) {}

  /** Every redirect of the space, cached by the CDN under `redirects:<space>` until one changes. */
  async redirects(access: ApiTokenAccess): Promise<Delivered<DeliveryRedirects>> {
    const rows = await this.db.serviceDb
      .select({ from: redirects.fromPath, to: redirects.toPath, status: redirects.status })
      .from(redirects)
      .where(eq(redirects.spaceId, access.spaceId))
      .orderBy(asc(redirects.fromPath))
      .limit(REDIRECTS_LIMIT);
    return {
      body: { items: rows.map((row) => ({ ...row, status: row.status as RedirectStatus })) },
      tags: [cacheTag.space(access.spaceId), cacheTag.redirects(access.spaceId)],
    };
  }

  /** Counts a visit to an address with no page: one row per address and day (0012_seo_site.sql). */
  async recordNotFound(access: ApiTokenAccess, report: { path: string; referrer: string | null }): Promise<void> {
    await this.db.serviceDb.execute(sql`select public.record_not_found(${access.spaceId}::uuid, ${report.path}, ${report.referrer})`);
  }
}
