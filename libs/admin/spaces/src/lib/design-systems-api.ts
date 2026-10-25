import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type {
  CreateDesignSystemVersionResponse,
  DesignSystem,
  DesignSystemClasses,
  DesignSystemVersion,
  SiteDesignSystem,
} from '@novan/shared-schemas';
import { lastValueFrom, type Observable } from 'rxjs';

export interface CreateDesignSystemRequest {
  name: string;
  slug: string;
  framework: DesignSystem['framework'];
}

export type CreateDesignSystemVersionRequest =
  | { source: 'css'; version: string; filename: string }
  | { source: 'url'; version: string; url: string };

/**
 * A space's design systems (docs/build/24-design-systems.md), for Settings › Design systems and the editor's class
 * suggestions: `/v1/management/spaces/:spaceId/design-systems` and `.../site/design-systems`.
 */
@Injectable({ providedIn: 'root' })
export class DesignSystemsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management/spaces`;

  list(spaceId: string): Observable<DesignSystem[]> {
    return this.http.get<DesignSystem[]>(`${this.base}/${spaceId}/design-systems`);
  }

  create(spaceId: string, body: CreateDesignSystemRequest): Observable<DesignSystem> {
    return this.http.post<DesignSystem>(`${this.base}/${spaceId}/design-systems`, body);
  }

  createVersion(spaceId: string, designSystemId: string, body: CreateDesignSystemVersionRequest): Observable<CreateDesignSystemVersionResponse> {
    return this.http.post<CreateDesignSystemVersionResponse>(`${this.base}/${spaceId}/design-systems/${designSystemId}/versions`, body);
  }

  /** Sends the stylesheet straight to Storage at the signed URL, not through the API. */
  upload(uploadUrl: string, file: File): Promise<unknown> {
    return lastValueFrom(this.http.put(uploadUrl, file, { headers: { 'content-type': 'text/css' } }));
  }

  complete(spaceId: string, designSystemId: string, versionId: string): Observable<DesignSystemVersion> {
    return this.http.post<DesignSystemVersion>(`${this.versionUrl(spaceId, designSystemId, versionId)}/complete`, {});
  }

  version(spaceId: string, designSystemId: string, versionId: string): Observable<DesignSystemVersion> {
    return this.http.get<DesignSystemVersion>(this.versionUrl(spaceId, designSystemId, versionId));
  }

  deprecate(spaceId: string, designSystemId: string, versionId: string): Observable<DesignSystemVersion> {
    return this.http.post<DesignSystemVersion>(`${this.versionUrl(spaceId, designSystemId, versionId)}/deprecate`, {});
  }

  /** Classes starting with `q`, shortest first; `group: ''` for classes in no group. */
  classes(
    spaceId: string,
    designSystemId: string,
    versionId: string,
    query: { q?: string; group?: string; limit?: number } = {},
  ): Observable<DesignSystemClasses> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params = params.set(key, String(value));
    return this.http.get<DesignSystemClasses>(`${this.versionUrl(spaceId, designSystemId, versionId)}/classes`, { params });
  }

  site(spaceId: string): Observable<SiteDesignSystem[]> {
    return this.http.get<SiteDesignSystem[]>(`${this.base}/${spaceId}/site/design-systems`);
  }

  /** These versions, loaded in this order; the rest are detached. */
  putSite(spaceId: string, items: { versionId: string; enabled: boolean }[]): Observable<SiteDesignSystem[]> {
    return this.http.put<SiteDesignSystem[]>(`${this.base}/${spaceId}/site/design-systems`, { items });
  }

  private versionUrl(spaceId: string, designSystemId: string, versionId: string): string {
    return `${this.base}/${spaceId}/design-systems/${designSystemId}/versions/${versionId}`;
  }
}
