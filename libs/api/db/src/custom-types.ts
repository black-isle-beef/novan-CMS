import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres `tsvector`, which drizzle-kit cannot pull (`tools/pull-schema.mjs` maps it here). The search columns
 * (0019_search.sql) are generated or written by triggers, so the API only filters and ranks with them in SQL.
 */
export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});
