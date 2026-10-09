import { Injectable, Logger } from '@nestjs/common';
import { apiTokens, DbService } from '@novan/api-db';
import type { ApiTokenScope } from '@novan/shared-schemas';
import { and, eq, isNull } from 'drizzle-orm';
import { hashToken } from './token-secret';

/** What a valid token gives access to: one environment of one space. */
export interface ApiTokenAccess {
  tokenId: string;
  scope: ApiTokenScope;
  spaceId: string;
  environmentId: string;
}

/** How long a looked-up token is trusted before it is checked again; a revoked token stops within this. */
export const TOKEN_CACHE_MS = 30_000;
/** `last_used_at` is written at most this often per token. */
const LAST_USED_EVERY_MS = 60_000;
const MAX_CACHED = 10_000;

/**
 * Looks tokens up by hash through the service role (the caller is a client site, not a member), caching
 * results briefly so the Delivery API does not query for every request. Revoking clears this instance's
 * cache at once; other API instances stop accepting the token within {@link TOKEN_CACHE_MS}.
 */
@Injectable()
export class ApiTokenResolver {
  private readonly logger = new Logger(ApiTokenResolver.name);
  private readonly cache = new Map<string, { access: ApiTokenAccess | null; until: number }>();
  private readonly lastUsed = new Map<string, number>();

  constructor(private readonly db: DbService) {}

  async resolve(token: string): Promise<ApiTokenAccess | null> {
    const hash = hashToken(token);
    const now = Date.now();
    const cached = this.cache.get(hash);
    const access = cached && cached.until > now ? cached.access : await this.lookup(hash);
    if (!cached || cached.until <= now) this.remember(hash, access, now);
    if (access) this.touch(access.tokenId, now);
    return access;
  }

  /** Forgets a token, so a revoke takes effect on this instance straight away. */
  forget(tokenId: string): void {
    for (const [hash, entry] of this.cache) {
      if (entry.access?.tokenId === tokenId) this.cache.delete(hash);
    }
  }

  private async lookup(hash: string): Promise<ApiTokenAccess | null> {
    const [row] = await this.db.serviceDb
      .select({
        tokenId: apiTokens.id,
        scope: apiTokens.scope,
        spaceId: apiTokens.spaceId,
        environmentId: apiTokens.environmentId,
      })
      .from(apiTokens)
      .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)));
    return row ? { ...row, scope: row.scope as ApiTokenScope } : null;
  }

  private remember(hash: string, access: ApiTokenAccess | null, now: number): void {
    if (this.cache.size >= MAX_CACHED) {
      for (const [key, entry] of this.cache) if (entry.until <= now) this.cache.delete(key);
      // Still full of live entries (a flood of made-up tokens): start again rather than grow.
      if (this.cache.size >= MAX_CACHED) this.cache.clear();
    }
    this.cache.set(hash, { access, until: now + TOKEN_CACHE_MS });
  }

  /** Records use without holding up the request; a lost write only makes `last_used_at` a little older. */
  private touch(tokenId: string, now: number): void {
    if ((this.lastUsed.get(tokenId) ?? 0) > now - LAST_USED_EVERY_MS) return;
    this.lastUsed.set(tokenId, now);
    this.db.serviceDb
      .update(apiTokens)
      .set({ lastUsedAt: new Date(now).toISOString() })
      .where(eq(apiTokens.id, tokenId))
      .then(
        () => undefined,
        (error: unknown) => this.logger.warn(`Could not record use of token ${tokenId}: ${String(error)}`),
      );
  }
}
