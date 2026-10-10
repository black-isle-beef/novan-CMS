import { Injectable, Logger } from '@nestjs/common';
import { notFound } from '@novan/api-common';
import { SupabaseAdmin } from '@novan/api-auth';
import { type ImageTransform, MEDIA_BUCKET } from '@novan/shared-schemas';

/** Where an asset's file lives in the bucket. */
export const assetPath = (spaceId: string, assetId: string, filename: string): string =>
  `spaces/${spaceId}/${assetId}/${filename}`;

/** Where the browser uploads to; the API checks the file there before moving it into place. */
export const pendingPath = (spaceId: string, assetId: string, filename: string): string =>
  `spaces/${spaceId}/${assetId}/pending/${filename}`;

/** Supabase image transformations need the Pro plan; elsewhere the original image is served. */
export const imageTransformsEnabled = (): boolean => process.env['SUPABASE_IMAGE_TRANSFORMS'] === 'true';

/**
 * The `media` bucket through the service role. Members never write to it: the API signs uploads to a
 * pending path, checks what arrived, and writes the checked file into place. Every caller has already
 * checked the space, because the service role bypasses storage RLS.
 */
@Injectable()
export class MediaStorage {
  private readonly logger = new Logger(MediaStorage.name);

  constructor(private readonly supabase: SupabaseAdmin) {}

  private get bucket() {
    return this.supabase.storage.from(MEDIA_BUCKET);
  }

  /** A URL the browser can `PUT` one file to (valid for two hours). */
  async signedUploadUrl(path: string): Promise<string> {
    const { data, error } = await this.bucket.createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new Error(`Could not sign an upload to ${path}: ${error?.message}`);
    return data.signedUrl;
  }

  /** The uploaded file, or 404 `upload_not_found` when nothing arrived. */
  async readPending(path: string): Promise<Buffer> {
    const { data, error } = await this.bucket.download(path);
    if (error || !data) throw notFound('upload_not_found', 'The upload did not arrive. Try uploading the file again.');
    return Buffer.from(await data.arrayBuffer());
  }

  /** Writes the checked file to its place (replacing what was there) and drops the pending copy. */
  async place(pending: string, path: string, bytes: Buffer, contentType: string): Promise<void> {
    const { error } = await this.bucket.upload(path, bytes, { contentType, upsert: true, cacheControl: '31536000' });
    if (error) throw new Error(`Could not store ${path}: ${error.message}`);
    await this.remove([pending]);
  }

  /** Best effort: a file left behind is only wasted space (housekeeping, package 17). */
  async remove(paths: string[]): Promise<void> {
    const { error } = await this.bucket.remove(paths);
    if (error) this.logger.warn(`Could not remove ${paths.join(', ')}: ${error.message}`);
  }

  /** Removes the files, throwing when Storage refuses, so the caller keeps its record and tries again later. */
  async removeOrThrow(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { error } = await this.bucket.remove(paths);
    if (error) throw new Error(`Could not remove ${paths.length} file(s) from Storage: ${error.message}`);
  }

  /** The file, resized when transformations are on and options are given. */
  async read(path: string, transform?: ImageTransform): Promise<{ bytes: Buffer; contentType: string } | null> {
    const { data, error } = await this.bucket.download(path, transform ? { transform } : undefined);
    if (error || !data) return null;
    return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type };
  }
}
