import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@novan/api-auth';
import { DbService, notFoundHits, redirects } from '@novan/api-db';
import type { NotFoundSummary, notFoundQuerySchema } from '@novan/shared-schemas';
import { and, desc, eq, gte, notExists, sql } from 'drizzle-orm';
import type { z } from 'zod';

type NotFoundQuery = z.output<typeof notFoundQuerySchema>;

/**
 * The addresses visitors found no page at (docs/build/14-seo-site-features.md), most visited first. Client sites
 * report them through the Delivery API (`POST /v1/delivery/not-found`); members read them here, under RLS.
 * Addresses that now redirect somewhere are left out: they have been dealt with.
 */
@Injectable()
export class NotFoundService {
  constructor(private readonly db: DbService) {}

  list(user: AuthUser, spaceId: string, query: NotFoundQuery): Promise<NotFoundSummary[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const hits = sql<number>`sum(${notFoundHits.hits})::int`;
      const rows = await tx
        .select({
          path: notFoundHits.path,
          hits,
          days: sql<number>`count(*)::int`,
          lastSeenAt: sql<string>`to_json(max(${notFoundHits.lastSeenAt})) #>> '{}'`,
          lastReferrer: sql<string | null>`(array_agg(${notFoundHits.lastReferrer} order by ${notFoundHits.lastSeenAt} desc)
            filter (where ${notFoundHits.lastReferrer} is not null))[1]`,
        })
        .from(notFoundHits)
        .where(
          and(
            eq(notFoundHits.spaceId, spaceId),
            gte(notFoundHits.day, sql`(now() at time zone 'utc')::date - ${query.days - 1}::int`),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(redirects)
                .where(and(eq(redirects.spaceId, notFoundHits.spaceId), eq(redirects.fromPath, notFoundHits.path))),
            ),
          ),
        )
        .groupBy(notFoundHits.path)
        .orderBy(desc(hits), notFoundHits.path)
        .limit(query.limit);
      return rows;
    });
  }
}
