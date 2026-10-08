import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import { MAIN_ENVIRONMENT } from '@novan/admin-content';
import type { DeliveryEntry, EntryData, SignedPreviewToken } from '@novan/shared-schemas';
import type { Observable } from 'rxjs';

/** The visual editor's calls to the management API. The auth interceptor adds the access token. */
@Injectable({ providedIn: 'root' })
export class EditorApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management/spaces`;

  /** A signed token that opens the page's drafts on the site for 15 minutes. */
  previewToken(spaceId: string, entryId: string): Observable<SignedPreviewToken> {
    const path = [spaceId, 'environments', MAIN_ENVIRONMENT, 'entries', entryId, 'preview-token'].map(encodeURIComponent).join('/');
    return this.http.post<SignedPreviewToken>(`${this.base}/${path}`, {});
  }

  /** Unsaved page data as the site gets it (files, references and links filled in), for the bridge's `update`. */
  previewData(spaceId: string, entryId: string, data: EntryData): Observable<DeliveryEntry> {
    const path = [spaceId, 'environments', MAIN_ENVIRONMENT, 'entries', entryId, 'preview-data'].map(encodeURIComponent).join('/');
    return this.http.post<DeliveryEntry>(`${this.base}/${path}`, { data });
  }
}
