import type { DbTransaction } from '@novan/api-db';

/** An entry's current data, as checked against a proposed model change. */
export interface StoredEntry {
  id: string;
  contentTypeId: string;
  data: unknown;
}

/**
 * Where model changes find the entries they could invalidate. Package 06 (entries and versions)
 * provides the real source, reading each entry's current version under the caller's RLS.
 */
export interface EntrySource {
  /** Entries of the environment, optionally only those of the given content types. */
  list(tx: DbTransaction, environmentId: string, contentTypeIds?: readonly string[]): Promise<StoredEntry[]>;
}

export const ENTRY_SOURCE = Symbol('ENTRY_SOURCE');

/** Until package 06 adds the `entries` table there are no entries to invalidate. */
export const noEntries: EntrySource = {
  list: () => Promise.resolve([]),
};
