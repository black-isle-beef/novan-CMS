import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, type SchemaWriter } from '@novan/schema-sync';
import { firstValueFrom, type Observable } from 'rxjs';
import type { SchemaApi } from '../schema-api';

/** Lets `applyChanges` from `@novan/schema-sync` push through the admin's {@link SchemaApi}, as the signed-in person. */
export function schemaWriter(api: SchemaApi): SchemaWriter<string> {
  return {
    createContentType: (spaceId, body) => call(api.createContentType(spaceId, body)),
    updateContentType: (spaceId, apiId, body, force) => call(api.updateContentType(spaceId, apiId, body, force)),
    deleteContentType: (spaceId, apiId, force) => call(api.deleteContentType(spaceId, apiId, force)),
    createBlockType: (spaceId, body) => call(api.createBlockType(spaceId, body)),
    updateBlockType: (spaceId, apiId, body, force) => call(api.updateBlockType(spaceId, apiId, body, force)),
    deleteBlockType: (spaceId, apiId, force) => call(api.deleteBlockType(spaceId, apiId, force)),
  };
}

/** The call's answer, with an API problem as an {@link ApiError}, so the push recognises `entries_invalidated` and `*_in_use`. */
async function call<T>(request: Observable<T>): Promise<T> {
  try {
    return await firstValueFrom(request);
  } catch (error) {
    throw toApiError(error);
  }
}

export function toApiError(error: unknown): unknown {
  if (!(error instanceof HttpErrorResponse)) return error;
  if (error.status === 0) return new ApiError(0, 'network_error', 'We could not reach Novan CMS. Check your connection and try again.', {});
  const body = typeof error.error === 'object' && error.error !== null ? (error.error as Record<string, unknown>) : {};
  const code = typeof body['code'] === 'string' ? body['code'] : `http_${error.status}`;
  const detail = typeof body['detail'] === 'string' ? body['detail'] : typeof body['title'] === 'string' ? body['title'] : 'Something went wrong. Please try again.';
  return new ApiError(error.status, code, detail, body);
}
