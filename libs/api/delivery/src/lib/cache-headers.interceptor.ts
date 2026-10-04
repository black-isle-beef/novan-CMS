import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { ApiTokenRequest } from './api-token.guard';
import type { Delivered } from './content-reader.service';

/** CDN keeps delivery responses until purged; browsers always revalidate. */
export const DELIVERY_CACHE_CONTROL = 'public, max-age=0, s-maxage=31536000, stale-while-revalidate=60';
export const PREVIEW_CACHE_CONTROL = 'private, no-store';
/** Errors, and anything before the token is checked. */
export const NO_STORE = 'no-store';

/** Cloudflare reads at most 16 KB of `Cache-Tag`; stay well under it. */
const MAX_TAG_HEADER = 15_000;

/** Every response of a token: purged when the token is revoked, so the CDN stops answering it. */
export const tokenTag = (tokenId: string): string => `token:${tokenId}`;
/** Responses whose tags did not fit; purged on every change in the space. */
export const overflowTag = (spaceId: string): string => `overflow:${spaceId}`;

/**
 * The `Cache-Tag` header value: the response's tags, the token's, and when that is too long for the CDN,
 * the first tags that fit plus the space's overflow tag (so the response is still purged when anything
 * in the space changes).
 */
export function cacheTagHeader(tags: readonly string[], tokenId: string, spaceId: string): string {
  const all = [...new Set([tokenTag(tokenId), ...tags])];
  const full = all.join(',');
  if (full.length <= MAX_TAG_HEADER) return full;

  const kept = [overflowTag(spaceId)];
  let length = kept[0].length;
  for (const tag of all) {
    if (length + tag.length + 1 > MAX_TAG_HEADER) break;
    kept.push(tag);
    length += tag.length + 1;
  }
  return kept.join(',');
}

/**
 * Turns a {@link Delivered} result into its body with caching headers: delivery responses are cached by
 * the CDN under their tags; preview responses are never cached. Express adds a weak `ETag` and answers
 * `If-None-Match` with 304. The token, not the URL, decides the space, so `Vary: Authorization` (the CDN's
 * cache key must include the header; see docs/build/08-delivery-preview-api.md).
 */
@Injectable()
export class CacheHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler<Delivered<unknown>>): Observable<unknown> {
    const http = context.switchToHttp();
    const access = http.getRequest<ApiTokenRequest>().apiToken;
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      map(({ body, tags }) => {
        res.setHeader('Vary', 'Authorization');
        if (access?.scope === 'delivery') {
          res.setHeader('Cache-Control', DELIVERY_CACHE_CONTROL);
          res.setHeader('Cache-Tag', cacheTagHeader(tags, access.tokenId, access.spaceId));
        } else {
          res.setHeader('Cache-Control', PREVIEW_CACHE_CONTROL);
        }
        return body;
      }),
    );
  }
}
