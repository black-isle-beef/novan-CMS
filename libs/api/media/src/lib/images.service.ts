import { Injectable } from '@nestjs/common';
import { cacheTag, notFound } from '@novan/api-common';
import { assets, assetUsages, DbService } from '@novan/api-db';
import type { ImageTransform } from '@novan/shared-schemas';
import { and, eq, exists, isNull } from 'drizzle-orm';
import { imageTransformsEnabled, MediaStorage } from './media-storage';

/** Types Supabase image transformations can resize. */
const transformable = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/** One year: the URL carries the revision, so a replaced file gets a new URL. */
const LONG_CACHE = 'public, max-age=31536000, s-maxage=31536000, immutable';
/** For URLs without the current revision (old links, hand-made URLs). */
const SHORT_CACHE = 'public, max-age=300, s-maxage=300';

const inline = (mime: string): boolean =>
  mime.startsWith('image/') || mime.startsWith('video/') || mime === 'application/pdf';

export interface ServedFile {
  bytes: Buffer;
  headers: Record<string, string>;
}

/**
 * The image route behind client sites: published files only, no token. A file is served while it is
 * live (not in the bin) and used by at least one published entry, so drafts and unused uploads stay
 * private. It reads through the service role, always by the asset's id; resizing happens only where
 * Supabase image transformations are on (`SUPABASE_IMAGE_TRANSFORMS=true`, Pro plan).
 */
@Injectable()
export class ImagesService {
  constructor(
    private readonly db: DbService,
    private readonly storage: MediaStorage,
  ) {}

  async serve(id: string, filename: string, query: ImageTransform & { v?: number }): Promise<ServedFile> {
    const [asset] = await this.db.serviceDb
      .select({ path: assets.path, filename: assets.filename, mime: assets.mime, revision: assets.revision })
      .from(assets)
      .where(
        and(
          eq(assets.id, id),
          isNull(assets.deletedAt),
          exists(
            this.db.serviceDb
              .select({ one: assetUsages.assetId })
              .from(assetUsages)
              .where(eq(assetUsages.assetId, assets.id)),
          ),
        ),
      );
    if (!asset || asset.filename !== filename) throw notFound('asset_not_found', 'There is no such published file.');

    const { v, ...options } = query;
    const resize = imageTransformsEnabled() && transformable.has(asset.mime) && Object.keys(options).length > 0;
    const file = await this.storage.read(asset.path, resize ? options : undefined);
    if (!file) throw notFound('asset_not_found', 'There is no such published file.');

    const contentType = resize && file.contentType ? file.contentType : asset.mime;
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': v === asset.revision ? LONG_CACHE : SHORT_CACHE,
      'Cache-Tag': cacheTag.asset(id),
      'X-Content-Type-Options': 'nosniff',
      // A file opened on its own cannot run script or load anything (SVG is sanitised as well).
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // Pictures, videos and PDFs open in the browser; other documents download. Filenames are already safe.
      'Content-Disposition': `${inline(contentType) ? 'inline' : 'attachment'}; filename="${asset.filename}"`,
    };
    return { bytes: file.bytes, headers };
  }
}
