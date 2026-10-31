// site-css.ts — the site's stylesheet of custom HTML blocks' CSS (`customHtml` in @novan/blocks): every published
// block's CSS, cleaned as uploaded stylesheets are (docs/build/24-design-systems.md) and scoped to its block, in the
// `novan-overrides` layer. Delivery `site-styles` links it, so the SDK puts it in every page's `<head>`. Preview never
// links it: there the block adds its own unsaved CSS, wrapped the same way (libs/blocks/.../custom-html.css.ts).
import { createHash } from 'node:crypto';
import { Controller, Get, Inject, Injectable, Param, Res } from '@nestjs/common';
import { cacheTag, notFound, ZodValidationPipe } from '@novan/api-common';
import { DbService, environments, publishedContent } from '@novan/api-db';
import { processBlockCss } from '@novan/api-design-systems';
import { cascadeLayers } from '@novan/shared-design-system';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { z } from 'zod';
import { DELIVERY_CACHE_CONTROL } from './cache-headers.interceptor';
import { DELIVERY_CONFIG, type DeliveryConfig } from './content-reader.service';

/** The block type whose CSS goes in the stylesheet. */
export const CUSTOM_HTML_BLOCK = 'customHtml';
/** The attribute the block puts its `_uid` in, which its CSS is scoped to. Kept equal to the block's by a spec. */
export const CUSTOM_HTML_SCOPE = 'data-novan-custom-html';

/** A `_uid` that can go in an attribute selector as it is. */
const SAFE_UID = /^[A-Za-z0-9-]{1,64}$/;

/** One block's CSS as an editor wrote it. */
export interface BlockCss {
  uid: string;
  css: string;
}

/**
 * The CSS of each custom HTML block in an entry's data, wherever it sits (a `blocks` field, a group, a block's
 * children), in page order. Hidden blocks and what they hold are left out. Safe on any JSON.
 */
export function blockCssOf(data: unknown): BlockCss[] {
  const found: BlockCss[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const node = value as Record<string, unknown>;
    // A hidden block is not on the page, and nor is anything inside it.
    if (typeof node['_block'] === 'string' && node['_hidden'] === true) return;
    if (node['_block'] === CUSTOM_HTML_BLOCK && typeof node['_uid'] === 'string' && typeof node['css'] === 'string' && node['css'].trim()) {
      found.push({ uid: node['_uid'], css: node['css'] });
    }
    Object.values(node).forEach(visit);
  };
  visit(data);
  return found;
}

/**
 * The stylesheet: the cascade layer order, then each block's cleaned CSS nested in its scope. A `_uid` seen twice keeps
 * its first CSS. Empty when no block has usable CSS.
 */
export function buildSiteCss(blocks: readonly BlockCss[]): string {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const { uid, css } of blocks) {
    if (!SAFE_UID.test(uid) || seen.has(uid)) continue;
    seen.add(uid);
    const cleaned = processBlockCss(css, `block ${uid}`).css;
    if (cleaned) rules.push(`@layer novan-overrides {\n[${CUSTOM_HTML_SCOPE}="${uid}"] {\n${cleaned}\n}\n}`);
  }
  return rules.length ? `${cascadeLayers()}\n${rules.join('\n')}\n` : '';
}

/** The stylesheet's tags: purged on every publish in the environment (`entries:`), and with the site's styles. */
export const siteCssTags = (spaceId: string, environmentId: string): string[] => [
  cacheTag.space(spaceId),
  cacheTag.entries(environmentId),
  cacheTag.siteStyles(environmentId),
];

/** Builds the stylesheet from published content only, through the service role, for one environment. */
@Injectable()
export class SiteCss {
  constructor(
    private readonly db: DbService,
    @Inject(DELIVERY_CONFIG) private readonly config: DeliveryConfig,
  ) {}

  /** The environment's stylesheet and space; null for an environment that does not exist. */
  async forEnvironment(environmentId: string): Promise<{ spaceId: string; css: string } | null> {
    const [environment] = await this.db.serviceDb
      .select({ spaceId: environments.spaceId })
      .from(environments)
      .where(eq(environments.id, environmentId));
    if (!environment) return null;
    return { spaceId: environment.spaceId, css: await this.css(environment.spaceId, environmentId) };
  }

  /** The stylesheet of the space's environment; empty without custom HTML blocks that have CSS. */
  async css(spaceId: string, environmentId: string): Promise<string> {
    const rows = await this.db.serviceDb
      .select({ data: publishedContent.data })
      .from(publishedContent)
      .where(
        and(
          eq(publishedContent.spaceId, spaceId),
          eq(publishedContent.environmentId, environmentId),
          sql`${publishedContent.data} @? ${`$.** ? (@._block == "${CUSTOM_HTML_BLOCK}")`}::jsonpath`,
        ),
      )
      .orderBy(asc(publishedContent.entryId));
    return buildSiteCss(rows.flatMap((row) => blockCssOf(row.data)));
  }

  /** Where sites load it from: the same address until the environment goes, so cached pages always find it. */
  href(environmentId: string): string {
    return `${this.config.publicApiUrl}/v1/site-css/${environmentId}/blocks.css`;
  }

  /** A short fingerprint of the stylesheet, given as its `version` in `site-styles`. */
  static version(css: string): string {
    return createHash('sha256').update(css).digest('hex').slice(0, 12);
  }
}

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/**
 * `GET /v1/site-css/:environmentId/blocks.css`, linked from every published page. No token, as for design system files:
 * it holds only published CSS, which every visitor's browser loads anyway. Cached by the CDN until a publish in the
 * environment purges it; browsers revalidate.
 */
@Controller('v1/site-css')
export class SiteCssController {
  constructor(private readonly siteCss: SiteCss) {}

  @Get(':environmentId/blocks.css')
  async serve(@Param('environmentId', idPipe) environmentId: string, @Res() res: Response): Promise<void> {
    const sheet = await this.siteCss.forEnvironment(environmentId);
    if (!sheet) throw notFound('site_css_not_found', 'There is no such site stylesheet.');
    res
      .set({
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': DELIVERY_CACHE_CONTROL,
        'Cache-Tag': siteCssTags(sheet.spaceId, environmentId).join(','),
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
        // Opened directly, nothing in it may run with the API's origin.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      })
      .send(sheet.css);
  }
}
