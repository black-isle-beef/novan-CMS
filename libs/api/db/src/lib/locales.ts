import { asc, desc, eq } from 'drizzle-orm';
import { spaceLocales, spaces } from '../schema';
import type { Database, DbTransaction } from './db.service';

/** A space's locales as the API describes them (`SpaceLocales` in shared-schemas, 0013_localisation.sql). */
export interface SpaceLocaleRows {
  /** The default locale first, then by name. */
  locales: { code: string; name: string; fallback: string | null; isDefault: boolean; prefix: string }[];
  /** Whether the site serves other locales under their prefix. */
  prefixes: boolean;
}

/** The space's locales: as the caller (RLS) with a user transaction, or any space's with the service connection. */
export async function readSpaceLocales(db: Database | DbTransaction, spaceId: string): Promise<SpaceLocaleRows> {
  const [locales, [space]] = await Promise.all([
    db
      .select({
        code: spaceLocales.code,
        name: spaceLocales.name,
        fallback: spaceLocales.fallbackCode,
        isDefault: spaceLocales.isDefault,
        prefix: spaceLocales.pathPrefix,
      })
      .from(spaceLocales)
      .where(eq(spaceLocales.spaceId, spaceId))
      .orderBy(desc(spaceLocales.isDefault), asc(spaceLocales.name), asc(spaceLocales.code)),
    db.select({ prefixes: spaces.localePrefixes }).from(spaces).where(eq(spaces.id, spaceId)),
  ]);
  return { locales, prefixes: space?.prefixes ?? false };
}
