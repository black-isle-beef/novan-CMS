import { inject, Injectable } from '@angular/core';
import { SupabaseClientService } from '@novan/admin-auth';
import { type Asset, MEDIA_BUCKET } from '@novan/shared-schemas';

/** Signed URLs last an hour; refresh them a little before. */
const LIFETIME_S = 60 * 60;
const REFRESH_MS = (LIFETIME_S - 5 * 60) * 1000;

/**
 * Short-lived URLs for showing library files in the admin. The bucket is private, so these are signed
 * through the signed-in user's Supabase session: storage RLS lets members read only their own spaces'
 * files. Cached per file and revision.
 */
@Injectable({ providedIn: 'root' })
export class Thumbnails {
  private readonly storage = inject(SupabaseClientService).client.storage;
  private readonly cache = new Map<string, { url: string; expires: number }>();

  /** URLs for the images and videos among `assets` (others get none), by asset id. */
  async urls(
    spaceId: string,
    assets: readonly Pick<Asset, 'id' | 'filename' | 'revision' | 'kind'>[],
  ): Promise<Map<string, string>> {
    const now = Date.now();
    const result = new Map<string, string>();
    const missing: { key: string; id: string; path: string }[] = [];
    for (const asset of assets) {
      if (asset.kind === 'file') continue;
      const key = `${asset.id}:${asset.revision}`;
      const cached = this.cache.get(key);
      if (cached && cached.expires > now) result.set(asset.id, cached.url);
      else missing.push({ key, id: asset.id, path: `spaces/${spaceId}/${asset.id}/${asset.filename}` });
    }
    if (!missing.length) return result;

    const { data } = await this.storage.from(MEDIA_BUCKET).createSignedUrls(
      missing.map((item) => item.path),
      LIFETIME_S,
    );
    data?.forEach((signed, index) => {
      if (!signed.signedUrl || signed.error) return;
      this.cache.set(missing[index].key, { url: signed.signedUrl, expires: now + REFRESH_MS });
      result.set(missing[index].id, signed.signedUrl);
    });
    return result;
  }
}
