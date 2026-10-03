import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type {
  BlockType,
  ContentType,
  CreateEntryRequest,
  CreateFolderRequest,
  Entry,
  EntryData,
  EntryDiff,
  EntrySummary,
  EntryVersion,
  Folder,
  ListEntriesQuery,
  UpdateFolderRequest,
} from '@novan/shared-schemas';
import type { Observable } from 'rxjs';

/** Environments get their own UI in phase 4; until then the admin edits `main`. */
export const MAIN_ENVIRONMENT = 'main';

/** Typed client for entries, folders and versions. The auth interceptor adds the access token. */
@Injectable({ providedIn: 'root' })
export class ContentApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management/spaces`;

  // --- Model (read only here) ---

  listContentTypes(spaceId: string): Observable<ContentType[]> {
    return this.http.get<ContentType[]>(this.url(spaceId, 'content-types'));
  }

  listBlockTypes(spaceId: string): Observable<BlockType[]> {
    return this.http.get<BlockType[]>(this.url(spaceId, 'block-types'));
  }

  // --- Folders ---

  listFolders(spaceId: string): Observable<Folder[]> {
    return this.http.get<Folder[]>(this.url(spaceId, 'folders'));
  }

  createFolder(spaceId: string, body: CreateFolderRequest): Observable<Folder> {
    return this.http.post<Folder>(this.url(spaceId, 'folders'), body);
  }

  updateFolder(spaceId: string, id: string, body: UpdateFolderRequest): Observable<Folder> {
    return this.http.patch<Folder>(this.url(spaceId, 'folders', id), body);
  }

  deleteFolder(spaceId: string, id: string): Observable<void> {
    return this.http.delete<void>(this.url(spaceId, 'folders', id));
  }

  // --- Entries ---

  listEntries(spaceId: string, query: ListEntriesQuery = {}): Observable<EntrySummary[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params = params.set(key, String(value));
    }
    return this.http.get<EntrySummary[]>(this.url(spaceId, 'entries'), { params });
  }

  getEntry(spaceId: string, id: string): Observable<Entry> {
    return this.http.get<Entry>(this.url(spaceId, 'entries', id));
  }

  createEntry(spaceId: string, body: CreateEntryRequest): Observable<Entry> {
    return this.http.post<Entry>(this.url(spaceId, 'entries'), body);
  }

  /** Saves a new version. */
  saveEntry(spaceId: string, id: string, data: EntryData, message?: string): Observable<Entry> {
    return this.http.patch<Entry>(this.url(spaceId, 'entries', id), { data, ...(message ? { message } : {}) });
  }

  autosaveEntry(spaceId: string, id: string, data: EntryData): Observable<Entry> {
    return this.http.post<Entry>(this.url(spaceId, 'entries', id, 'autosave'), { data });
  }

  publish(spaceId: string, id: string): Observable<Entry> {
    return this.http.post<Entry>(this.url(spaceId, 'entries', id, 'publish'), {});
  }

  unpublish(spaceId: string, id: string): Observable<Entry> {
    return this.http.post<Entry>(this.url(spaceId, 'entries', id, 'unpublish'), {});
  }

  moveEntry(spaceId: string, id: string, folderId: string | null): Observable<Entry> {
    return this.http.post<Entry>(this.url(spaceId, 'entries', id, 'move'), { folderId });
  }

  /** Moves the entry to the bin. */
  deleteEntry(spaceId: string, id: string): Observable<void> {
    return this.http.delete<void>(this.url(spaceId, 'entries', id));
  }

  /** Takes the entry out of the bin. */
  restoreEntry(spaceId: string, id: string): Observable<Entry> {
    return this.http.post<Entry>(this.url(spaceId, 'entries', id, 'restore'), {});
  }

  // --- Versions ---

  listVersions(spaceId: string, id: string): Observable<EntryVersion[]> {
    return this.http.get<EntryVersion[]>(this.url(spaceId, 'entries', id, 'versions'));
  }

  restoreVersion(spaceId: string, id: string, versionId: string): Observable<Entry> {
    return this.http.post<Entry>(this.url(spaceId, 'entries', id, 'restore', versionId), {});
  }

  diff(spaceId: string, from: string, to: string): Observable<EntryDiff> {
    return this.http.get<EntryDiff>(this.url(spaceId, 'versions', from, 'diff', to));
  }

  private url(spaceId: string, ...parts: string[]): string {
    return [`${this.base}/${spaceId}/environments/${MAIN_ENVIRONMENT}`, ...parts.map(encodeURIComponent)].join('/');
  }
}
