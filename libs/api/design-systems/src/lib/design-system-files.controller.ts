import { Controller, Get, Injectable, Param, Res } from '@nestjs/common';
import { cacheTag, notFound, ZodValidationPipe } from '@novan/api-common';
import { DbService, designSystemVersions, spaceDesignSystems } from '@novan/api-db';
import { and, eq, exists, inArray } from 'drizzle-orm';
import type { Response } from 'express';
import { z } from 'zod';
import { DesignSystemStorage, filePath, versionPrefix } from './design-system-storage';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/** A path inside a version's files: plain segments only. */
const SAFE_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/** Only files of versions a site loads are served; the rest of the bucket stays private. */
@Injectable()
export class DesignSystemFiles {
  constructor(
    private readonly db: DbService,
    private readonly storage: DesignSystemStorage,
  ) {}

  async read(versionId: string, path: string): Promise<{ bytes: Buffer; contentType: string }> {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPES[extension];
    if (!SAFE_PATH.test(path) || path.length > 200 || !contentType) throw missing();
    const [version] = await this.db.serviceDb
      .select({ spaceId: designSystemVersions.spaceId, designSystemId: designSystemVersions.designSystemId })
      .from(designSystemVersions)
      .where(
        and(
          eq(designSystemVersions.id, versionId),
          inArray(designSystemVersions.status, ['ready', 'deprecated']),
          exists(this.db.serviceDb.select().from(spaceDesignSystems).where(eq(spaceDesignSystems.versionId, versionId))),
        ),
      );
    if (!version) throw missing();
    const file = await this.storage.read(filePath(versionPrefix(version.spaceId, version.designSystemId, versionId), path));
    if (!file) throw missing();
    return { bytes: file.bytes, contentType };
  }
}

const missing = () => notFound('file_not_found', 'There is no such design system file.');

/**
 * Design system files for client sites, cached by the CDN for good: `GET /v1/design-system-files/:versionId/<path>`.
 * No token, as for `/v1/assets`: only ready versions attached to a site are served, and a version's files never
 * change. Fonts and module scripts load across origins, so any origin may read them.
 */
@Controller('v1/design-system-files')
export class DesignSystemFilesController {
  constructor(private readonly files: DesignSystemFiles) {}

  @Get(':versionId/*path')
  async serve(@Param('versionId', idPipe) versionId: string, @Param('path') path: string | string[], @Res() res: Response): Promise<void> {
    const file = await this.files.read(versionId, Array.isArray(path) ? path.join('/') : path);
    res
      .set({
        'Content-Type': file.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cache-Tag': cacheTag.designSystem(versionId),
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
        // Opened directly, nothing in it may run with the API's origin.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      })
      .send(file.bytes);
  }
}
