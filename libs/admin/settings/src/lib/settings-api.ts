import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type { ApiToken, CreateApiTokenRequest, CreatedApiToken } from '@novan/shared-schemas';
import type { Observable } from 'rxjs';

/** Typed client for a space's settings under `/v1/management/spaces/:spaceId`. */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management/spaces`;

  listApiTokens(spaceId: string): Observable<ApiToken[]> {
    return this.http.get<ApiToken[]>(`${this.base}/${spaceId}/api-tokens`);
  }

  /** The response carries the token's secret; this is the only time it is sent. */
  createApiToken(spaceId: string, body: CreateApiTokenRequest): Observable<CreatedApiToken> {
    return this.http.post<CreatedApiToken>(`${this.base}/${spaceId}/api-tokens`, body);
  }

  revokeApiToken(spaceId: string, id: string): Observable<ApiToken> {
    return this.http.post<ApiToken>(`${this.base}/${spaceId}/api-tokens/${id}/revoke`, {});
  }
}
