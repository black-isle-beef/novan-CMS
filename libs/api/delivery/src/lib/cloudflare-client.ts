import { Inject, Injectable } from '@nestjs/common';

export const CLOUDFLARE_CONFIG = Symbol('CLOUDFLARE_CONFIG');

export interface CloudflareConfig {
  /** Unset locally: purging is then skipped. */
  zoneId?: string;
  apiToken?: string;
  /** `https://api.cloudflare.com/client/v4` unless a test points it elsewhere. */
  apiUrl: string;
}

export function cloudflareConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CloudflareConfig {
  return {
    zoneId: env['CLOUDFLARE_ZONE_ID'] || undefined,
    apiToken: env['CLOUDFLARE_API_TOKEN'] || undefined,
    apiUrl: (env['CLOUDFLARE_API_URL'] || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, ''),
  };
}

/** Cloudflare accepts at most this many tags, or URLs, in one purge request. */
export const PURGE_BATCH = 30;

/** Raised when Cloudflare refuses a purge, e.g. a plan without purge by tag. */
export class CloudflarePurgeError extends Error {}

/** The Cloudflare cache purge API for the configured zone. */
@Injectable()
export class CloudflareClient {
  constructor(@Inject(CLOUDFLARE_CONFIG) private readonly config: CloudflareConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.zoneId);
  }

  purgeTags(tags: readonly string[]): Promise<void> {
    return this.purge({ tags });
  }

  purgeUrls(urls: readonly string[]): Promise<void> {
    return this.purge({ files: urls });
  }

  private async purge(body: { tags: readonly string[] } | { files: readonly string[] }): Promise<void> {
    const res = await fetch(`${this.config.apiUrl}/zones/${this.config.zoneId}/purge_cache`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.apiToken ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await res.json().catch(() => null)) as { success?: boolean; errors?: { message?: string }[] } | null;
    if (!res.ok || !result?.success) {
      const reason = result?.errors?.map((error) => error.message).join('; ') || `HTTP ${res.status}`;
      throw new CloudflarePurgeError(`Cloudflare refused the purge: ${reason}`);
    }
  }
}
