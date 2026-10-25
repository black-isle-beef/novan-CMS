import { Injectable, Logger } from '@nestjs/common';
import { SupabaseAdmin } from '@novan/api-auth';
import { DESIGN_SYSTEMS_BUCKET } from '@novan/shared-schemas';

/** A version's folder in the bucket: `spaces/<space>/<design system>/<version id>`. */
export const versionPrefix = (spaceId: string, designSystemId: string, versionId: string): string =>
  `spaces/${spaceId}/${designSystemId}/${versionId}`;

/** Where the browser uploads to; the worker checks the file there and writes what it serves under `files/`. */
export const pendingPath = (prefix: string, filename: string): string => `${prefix}/pending/${filename}`;

/** A processed file the site loads. */
export const filePath = (prefix: string, path: string): string => `${prefix}/files/${path}`;

/**
 * The `design-systems` bucket through the service role. As with the media library, members never write to it, and
 * every caller has already checked the space, because the service role bypasses storage RLS.
 */
@Injectable()
export class DesignSystemStorage {
  private readonly logger = new Logger(DesignSystemStorage.name);

  constructor(private readonly supabase: SupabaseAdmin) {}

  private get bucket() {
    return this.supabase.storage.from(DESIGN_SYSTEMS_BUCKET);
  }

  /** A URL the browser can `PUT` one file to. */
  async signedUploadUrl(path: string): Promise<string> {
    const { data, error } = await this.bucket.createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new Error(`Could not sign an upload to ${path}: ${error?.message}`);
    return data.signedUrl;
  }

  /** The file, or null when there is none. */
  async read(path: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const { data, error } = await this.bucket.download(path);
    if (error || !data) return null;
    return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type };
  }

  /** Writes a processed file. Versions never change once ready, so it is cached for a year wherever it goes. */
  async write(path: string, bytes: Buffer, contentType: string): Promise<void> {
    const { error } = await this.bucket.upload(path, bytes, { contentType, upsert: true, cacheControl: '31536000' });
    if (error) throw new Error(`Could not store ${path}: ${error.message}`);
  }

  /** Best effort: a file left behind is only wasted space. */
  async remove(paths: string[]): Promise<void> {
    const { error } = await this.bucket.remove(paths);
    if (error) this.logger.warn(`Could not remove ${paths.join(', ')}: ${error.message}`);
  }
}
