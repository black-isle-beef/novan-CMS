import { type ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { ProblemException } from '@novan/api-common';
import { ThrottlerGuard, type ThrottlerLimitDetail, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { ApiTokenScope } from '@novan/shared-schemas';
import type { ApiTokenRequest } from './api-token.guard';

/** Requests per second per token; `DELIVERY_RATE_LIMIT` and `PREVIEW_RATE_LIMIT` override them (load tests). */
export const DEFAULT_RATE_LIMITS: Readonly<Record<ApiTokenScope, number>> = { delivery: 50, preview: 10 };

/** Not-found reports a minute per delivery token (package 14); `NOT_FOUND_RATE_LIMIT` overrides it. */
export const DEFAULT_NOT_FOUND_RATE_LIMIT = 60;

export type RateLimits = Record<ApiTokenScope, number> & { notFound: number };

export function rateLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimits {
  const read = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  return {
    delivery: read('DELIVERY_RATE_LIMIT', DEFAULT_RATE_LIMITS.delivery),
    preview: read('PREVIEW_RATE_LIMIT', DEFAULT_RATE_LIMITS.preview),
    notFound: read('NOT_FOUND_RATE_LIMIT', DEFAULT_NOT_FOUND_RATE_LIMIT),
  };
}

const NOT_FOUND_REPORTS = 'novan:notFoundReports';

/** Marks the route sites report misses to: it has a per-minute limit of its own. */
export const NotFoundReports = (): MethodDecorator => SetMetadata(NOT_FOUND_REPORTS, true);

const tokenOf = (context: ExecutionContext) => context.switchToHttp().getRequest<ApiTokenRequest>().apiToken;

/**
 * One window of a second per token, shared by every route of the API the token is for, and a window of a minute
 * for not-found reports. Counts are kept in memory, so each API instance allows the limit on its own (a shared
 * store can come with scaling out).
 */
export function throttlerOptions(limits: RateLimits): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        // `default` keeps the plain header names (`Retry-After`, `X-RateLimit-Limit`); others get a suffix.
        name: 'default',
        ttl: 1000,
        limit: (context) => limits[tokenOf(context)?.scope ?? 'preview'],
      },
      {
        // A crawler trying addresses must not turn into a stream of writes.
        name: 'notFound',
        ttl: 60_000,
        limit: limits.notFound,
        skipIf: (context) => Reflect.getMetadata(NOT_FOUND_REPORTS, context.getHandler()) !== true,
      },
    ],
    // Runs after ApiTokenGuard, so the token is known and valid.
    getTracker: (req) => (req as ApiTokenRequest).apiToken?.tokenId ?? 'unknown',
    generateKey: (_context, tracker, name) => `${name}:${tracker}`,
  };
}

/** Rate limits per API token, answering 429 `rate_limited` as problem details with `Retry-After`. */
@Injectable()
export class ApiTokenThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const scope = tokenOf(context)?.scope ?? 'delivery';
    const per = detail.ttl >= 60_000 ? 'a minute' : 'a second';
    throw new ProblemException(
      HttpStatus.TOO_MANY_REQUESTS,
      'rate_limited',
      'Too many requests',
      `This ${scope} token is limited to ${detail.limit} requests ${per}. Try again in a moment.`,
    );
  }
}
