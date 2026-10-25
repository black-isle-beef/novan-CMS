import { Inject, Injectable } from '@nestjs/common';
import { cacheTag } from '@novan/api-common';
import { DbService, designSystems, designSystemVersions, redirects, spaceDesignSystems } from '@novan/api-db';
import { cascadeLayers } from '@novan/shared-design-system';
import type { DeliveryRedirects, RedirectStatus, SiteStyles } from '@novan/shared-schemas';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { ApiTokenAccess } from './api-token-resolver';
import { DELIVERY_CONFIG, type DeliveryConfig, type Delivered } from './content-reader.service';

/** A space keeps at most this many redirects in one response; more is a sign something is wrong. */
const REDIRECTS_LIMIT = 50_000;

/**
 * What client sites' servers need besides content (docs/build/14-seo-site-features.md): the space's redirects, to
 * apply before rendering, somewhere to report addresses with no page, and the design systems to load
 * (docs/build/24-design-systems.md). Through the service role, always for the token's space only.
 */
@Injectable()
export class SiteReader {
  constructor(
    private readonly db: DbService,
    @Inject(DELIVERY_CONFIG) private readonly config: DeliveryConfig,
  ) {}

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

  /**
   * The stylesheets of the design systems attached to the token's environment, in load order, and the first one's
   * framework for the site's class adapter. Drafts and live pages load the same: attaching is a site setting.
   */
  async siteStyles(access: ApiTokenAccess): Promise<Delivered<SiteStyles>> {
    const rows = await this.db.serviceDb
      .select({
        versionId: designSystemVersions.id,
        version: designSystemVersions.version,
        cssEntry: designSystemVersions.cssEntry,
        manifest: designSystemVersions.manifest,
        slug: designSystems.slug,
        framework: designSystems.framework,
      })
      .from(spaceDesignSystems)
      .innerJoin(designSystemVersions, eq(designSystemVersions.id, spaceDesignSystems.versionId))
      .innerJoin(designSystems, eq(designSystems.id, spaceDesignSystems.designSystemId))
      .where(
        and(
          eq(spaceDesignSystems.spaceId, access.spaceId),
          eq(spaceDesignSystems.environmentId, access.environmentId),
          eq(spaceDesignSystems.enabled, true),
          inArray(designSystemVersions.status, ['ready', 'deprecated']),
        ),
      )
      .orderBy(asc(spaceDesignSystems.loadOrder));
    const first = rows[0];
    const templates = (first?.manifest ?? {}) as { breakpoints?: Record<string, string>; states?: Record<string, string> };
    return {
      body: {
        layers: cascadeLayers(),
        stylesheets: rows.flatMap((row) =>
          row.cssEntry.map((path) => ({ href: this.fileUrl(row.versionId, path), designSystem: row.slug, version: row.version })),
        ),
        adapter: first
          ? {
              framework: first.framework,
              ...(templates.breakpoints ? { breakpoints: templates.breakpoints } : {}),
              ...(templates.states ? { states: templates.states } : {}),
            }
          : null,
      },
      tags: [cacheTag.space(access.spaceId), cacheTag.siteStyles(access.environmentId)],
    };
  }

  /** Counts a visit to an address with no page: one row per address and day (0012_seo_site.sql). */
  async recordNotFound(access: ApiTokenAccess, report: { path: string; referrer: string | null }): Promise<void> {
    await this.db.serviceDb.execute(sql`select public.record_not_found(${access.spaceId}::uuid, ${report.path}, ${report.referrer})`);
  }

  private fileUrl(versionId: string, path: string): string {
    return `${this.config.publicApiUrl}/v1/design-system-files/${versionId}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
}
