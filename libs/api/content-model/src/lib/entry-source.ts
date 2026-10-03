import { Injectable } from '@nestjs/common';
import { type DbTransaction, entries, entryVersions } from '@novan/api-db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

/** An entry's current data, as checked against a proposed model change. */
export interface StoredEntry {
  id: string;
  contentTypeId: string;
  data: unknown;
}

/** Where model changes find the entries they could invalidate. */
export interface EntrySource {
  /** Live entries (not in the bin) of the environment, optionally only those of the given content types. */
  list(tx: DbTransaction, environmentId: string, contentTypeIds?: readonly string[]): Promise<StoredEntry[]>;
}

export const ENTRY_SOURCE = Symbol('ENTRY_SOURCE');

/** No entries at all, for tests that supply their own. */
export const noEntries: EntrySource = {
  list: () => Promise.resolve([]),
};

/** Reads each entry's current version under the caller's RLS, in the model change's transaction. */
@Injectable()
export class DbEntrySource implements EntrySource {
  async list(tx: DbTransaction, environmentId: string, contentTypeIds?: readonly string[]): Promise<StoredEntry[]> {
    if (contentTypeIds?.length === 0) return [];
    return tx
      .select({ id: entries.id, contentTypeId: entries.contentTypeId, data: entryVersions.data })
      .from(entries)
      .innerJoin(entryVersions, eq(entryVersions.id, entries.currentVersionId))
      .where(
        and(
          eq(entries.environmentId, environmentId),
          isNull(entries.deletedAt),
          contentTypeIds ? inArray(entries.contentTypeId, [...contentTypeIds]) : undefined,
        ),
      );
  }
}
