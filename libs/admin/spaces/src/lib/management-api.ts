import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type {
  CreateSpaceRequest,
  InviteRequest,
  MeResponse,
  Member,
  OnboardingResponse,
  SpaceRole,
  SpaceSummary,
  UpdateSpaceRequest,
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

  updateSpace(spaceId: string, body: UpdateSpaceRequest): Observable<SpaceSummary> {
    return this.http.patch<SpaceSummary>(`${this.base}/spaces/${spaceId}`, body);
  }

  onboarding(spaceId: string): Observable<OnboardingResponse> {
    return this.http.get<OnboardingResponse>(`${this.base}/spaces/${spaceId}/onboarding`);
  }

  dismissOnboarding(spaceId: string): Observable<OnboardingResponse> {
    return this.http.post<OnboardingResponse>(`${this.base}/spaces/${spaceId}/onboarding/dismiss`, {});
  }

  /** Audits agency staff starting (ole) or stopping (
ull) viewing the space as a role. */
  viewAs(spaceId: string, role: SpaceRole | null): Observable<void> {
    return this.http.post<void>(`${this.base}/spaces/${spaceId}/view-as`, { role });
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
