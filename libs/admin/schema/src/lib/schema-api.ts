import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type {
  BlockType,
  ContentType,
  CreateBlockTypeRequest,
  CreateContentTypeRequest,
  UpdateBlockTypeRequest,
  UpdateContentTypeRequest,
} from '@novan/shared-schemas';
import type { Observable } from 'rxjs';

/** Environments get their own UI in phase 4; until then the admin models `main`. */
export const MAIN_ENVIRONMENT = 'main';

export type ModelKind = 'content-types' | 'block-types';

/** Typed client for the content model endpoints. The auth interceptor adds the access token. */
@Injectable({ providedIn: 'root' })
export class SchemaApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management/spaces`;

  listContentTypes(spaceId: string): Observable<ContentType[]> {
    return this.http.get<ContentType[]>(this.url(spaceId, 'content-types'));
  }

  getContentType(spaceId: string, apiId: string): Observable<ContentType> {
    return this.http.get<ContentType>(this.url(spaceId, 'content-types', apiId));
  }

  createContentType(spaceId: string, body: CreateContentTypeRequest): Observable<ContentType> {
    return this.http.post<ContentType>(this.url(spaceId, 'content-types'), body);
  }

  updateContentType(spaceId: string, apiId: string, body: UpdateContentTypeRequest, force = false): Observable<ContentType> {
    return this.http.patch<ContentType>(this.url(spaceId, 'content-types', apiId), body, { params: forceParams(force) });
  }

  deleteContentType(spaceId: string, apiId: string, force = false): Observable<void> {
    return this.http.delete<void>(this.url(spaceId, 'content-types', apiId), { params: forceParams(force) });
  }

  listBlockTypes(spaceId: string): Observable<BlockType[]> {
    return this.http.get<BlockType[]>(this.url(spaceId, 'block-types'));
  }

  getBlockType(spaceId: string, apiId: string): Observable<BlockType> {
    return this.http.get<BlockType>(this.url(spaceId, 'block-types', apiId));
  }

  createBlockType(spaceId: string, body: CreateBlockTypeRequest): Observable<BlockType> {
    return this.http.post<BlockType>(this.url(spaceId, 'block-types'), body);
  }

  updateBlockType(spaceId: string, apiId: string, body: UpdateBlockTypeRequest, force = false): Observable<BlockType> {
    return this.http.patch<BlockType>(this.url(spaceId, 'block-types', apiId), body, { params: forceParams(force) });
  }

  deleteBlockType(spaceId: string, apiId: string, force = false): Observable<void> {
    return this.http.delete<void>(this.url(spaceId, 'block-types', apiId), { params: forceParams(force) });
  }

  private url(spaceId: string, kind: ModelKind, apiId?: string): string {
    const collection = `${this.base}/${spaceId}/environments/${MAIN_ENVIRONMENT}/${kind}`;
    return apiId ? `${collection}/${encodeURIComponent(apiId)}` : collection;
  }
}

const forceParams = (force: boolean): Record<string, string> => (force ? { force: 'true' } : {});
