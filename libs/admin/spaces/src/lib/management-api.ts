import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type {
  CreateSpaceRequest,
  InviteRequest,
  MeResponse,
  Member,
  SpaceRole,
  SpaceSummary,
} from '@novan/shared-schemas';
import type { Observable } from 'rxjs';

/** Typed client for `/v1/management`. The auth interceptor adds the access token. */
@Injectable({ providedIn: 'root' })
export class ManagementApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management`;

  me(): Observable<MeResponse> {
    return this.http.get<MeResponse>(`${this.base}/me`);
  }

  listSpaces(): Observable<SpaceSummary[]> {
    return this.http.get<SpaceSummary[]>(`${this.base}/spaces`);
  }

  createSpace(body: CreateSpaceRequest): Observable<SpaceSummary> {
    return this.http.post<SpaceSummary>(`${this.base}/spaces`, body);
  }

  listMembers(spaceId: string): Observable<Member[]> {
    return this.http.get<Member[]>(`${this.base}/spaces/${spaceId}/members`);
  }

  invite(spaceId: string, body: InviteRequest): Observable<Member> {
    return this.http.post<Member>(`${this.base}/spaces/${spaceId}/invites`, body);
  }

  changeRole(spaceId: string, userId: string, role: SpaceRole): Observable<Member> {
    return this.http.patch<Member>(`${this.base}/spaces/${spaceId}/members/${userId}`, { role });
  }

  removeMember(spaceId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/spaces/${spaceId}/members/${userId}`);
  }
}
