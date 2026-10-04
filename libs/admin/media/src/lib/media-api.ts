import { HttpClient, HttpEventType, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type {
  Asset,
  AssetDetail,
  AssetFolderSummary,
  CompleteUploadRequest,
  ListAssetsQuery,
  UpdateAssetRequest,
  UploadUrlResponse,
} from '@novan/shared-schemas';
import { lastValueFrom, type Observable, tap } from 'rxjs';

/** Typed client for the media library. The auth interceptor adds the access token to API calls. */
@Injectable({ providedIn: 'root' })
export class MediaApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management/spaces`;

  list(spaceId: string, query: ListAssetsQuery & { ids?: string } = {}): Observable<Asset[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<Asset[]>(this.url(spaceId), { params });
  }

  folders(spaceId: string): Observable<AssetFolderSummary[]> {
    return this.http.get<AssetFolderSummary[]>(this.url(spaceId, 'folders'));
  }

  get(spaceId: string, id: string): Observable<AssetDetail> {
    return this.http.get<AssetDetail>(this.url(spaceId, id));
  }

  uploadUrl(spaceId: string, file: File): Observable<UploadUrlResponse> {
    return this.http.post<UploadUrlResponse>(this.url(spaceId, 'upload-url'), {
      filename: file.name,
      sizeBytes: file.size,
    });
  }

  complete(spaceId: string, body: CompleteUploadRequest): Observable<AssetDetail> {
    return this.http.post<AssetDetail>(this.url(spaceId, 'complete'), body);
  }

  update(spaceId: string, id: string, body: UpdateAssetRequest): Observable<AssetDetail> {
    return this.http.patch<AssetDetail>(this.url(spaceId, id), body);
  }

  replaceUrl(spaceId: string, id: string, file: File): Observable<UploadUrlResponse> {
    return this.http.post<UploadUrlResponse>(this.url(spaceId, id, 'replace-url'), {
      filename: file.name,
      sizeBytes: file.size,
    });
  }

  replace(spaceId: string, id: string, filename: string): Observable<AssetDetail> {
    return this.http.post<AssetDetail>(this.url(spaceId, id, 'replace'), { filename });
  }

  /** Moves the file to the bin. */
  remove(spaceId: string, id: string): Observable<void> {
    return this.http.delete<void>(this.url(spaceId, id));
  }

  restore(spaceId: string, id: string): Observable<AssetDetail> {
    return this.http.post<AssetDetail>(this.url(spaceId, id, 'restore'), {});
  }

  /**
   * Sends the file straight to Supabase Storage at the signed URL (not through the API), reporting
   * progress from 0 to 100.
   */
  put(target: UploadUrlResponse, file: File, progress: (percent: number) => void): Promise<unknown> {
    return lastValueFrom(
      this.http
        .put(target.uploadUrl, file, {
          headers: { 'content-type': target.mime },
          reportProgress: true,
          observe: 'events',
        })
        .pipe(
          tap((event) => {
            if (event.type === HttpEventType.UploadProgress && event.total)
              progress(Math.round((event.loaded / event.total) * 100));
          }),
        ),
    );
  }

  private url(spaceId: string, ...parts: string[]): string {
    return [`${this.base}/${spaceId}/assets`, ...parts.map(encodeURIComponent)].join('/');
  }
}
