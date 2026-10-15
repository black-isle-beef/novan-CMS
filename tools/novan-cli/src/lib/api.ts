import type {
  Asset,
  AssetDetail,
  BlockType,
  CompleteUploadRequest,
  ContentType,
  CreateApiTokenRequest,
  CreateBlockTypeRequest,
  CreateContentTypeRequest,
  CreatedApiToken,
  CreateEntryRequest,
  CreateFolderRequest,
  CreateSpaceRequest,
  DeviceAuthorization,
  DeviceAuthSettings,
  DeviceToken,
  Entry,
  EntrySummary,
  Folder,
  MeResponse,
  ManagedLocales,
  SpaceSummary,
  UpdateBlockTypeRequest,
  UpdateContentTypeRequest,
  UploadUrlRequest,
  UploadUrlResponse,
} from '@novan/shared-schemas';
import { ApiError, CliError } from './errors';

type Query = Record<string, string | undefined>;

/** Where the CLI works: an API, a space and one of its environments. */
export interface Target {
  apiUrl: string;
  spaceId: string;
  environment: string;
}

/** The parts of the Novan API the CLI uses. Each call answers the API's JSON, or throws {@link ApiError}. */
export class NovanApi {
  readonly apiUrl: string;

  constructor(
    apiUrl: string,
    /** The access token for management routes; not called for the public device sign-in routes. */
    private readonly token: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
  }

  // --- Device sign-in (public) ------------------------------------------------------------------

  startDeviceAuthorization(clientName: string): Promise<DeviceAuthorization> {
    return this.request('POST', '/v1/auth/device-authorizations', { body: { clientName }, auth: false });
  }

  deviceToken(deviceCode: string): Promise<DeviceToken> {
    return this.request('POST', '/v1/auth/device-authorizations/token', { body: { deviceCode }, auth: false });
  }

  authSettings(): Promise<DeviceAuthSettings> {
    return this.request('GET', '/v1/auth/device-authorizations/settings', { auth: false });
  }

  // --- Spaces -----------------------------------------------------------------------------------

  me(): Promise<MeResponse> {
    return this.request('GET', '/v1/management/me');
  }

  spaces(): Promise<SpaceSummary[]> {
    return this.request('GET', '/v1/management/spaces');
  }

  createSpace(body: CreateSpaceRequest): Promise<SpaceSummary> {
    return this.request('POST', '/v1/management/spaces', { body });
  }

  createApiToken(spaceId: string, body: CreateApiTokenRequest): Promise<CreatedApiToken> {
    return this.request('POST', `/v1/management/spaces/${spaceId}/api-tokens`, { body });
  }

  locales(spaceId: string): Promise<ManagedLocales> {
    return this.request('GET', `/v1/management/spaces/${spaceId}/locales`);
  }

  // --- Content model ----------------------------------------------------------------------------

  contentTypes(t: Target): Promise<ContentType[]> {
    return this.request('GET', `${env(t)}/content-types`);
  }

  createContentType(t: Target, body: CreateContentTypeRequest): Promise<ContentType> {
    return this.request('POST', `${env(t)}/content-types`, { body });
  }

  updateContentType(t: Target, apiId: string, body: UpdateContentTypeRequest, force: boolean): Promise<ContentType> {
    return this.request('PATCH', `${env(t)}/content-types/${apiId}`, { body, query: forceQuery(force) });
  }

  deleteContentType(t: Target, apiId: string, force: boolean): Promise<void> {
    return this.request('DELETE', `${env(t)}/content-types/${apiId}`, { query: forceQuery(force) });
  }

  blockTypes(t: Target): Promise<BlockType[]> {
    return this.request('GET', `${env(t)}/block-types`);
  }

  createBlockType(t: Target, body: CreateBlockTypeRequest): Promise<BlockType> {
    return this.request('POST', `${env(t)}/block-types`, { body });
  }

  updateBlockType(t: Target, apiId: string, body: UpdateBlockTypeRequest, force: boolean): Promise<BlockType> {
    return this.request('PATCH', `${env(t)}/block-types/${apiId}`, { body, query: forceQuery(force) });
  }

  deleteBlockType(t: Target, apiId: string, force: boolean): Promise<void> {
    return this.request('DELETE', `${env(t)}/block-types/${apiId}`, { query: forceQuery(force) });
  }

  // --- Content ----------------------------------------------------------------------------------

  folders(t: Target): Promise<Folder[]> {
    return this.request('GET', `${env(t)}/folders`);
  }

  createFolder(t: Target, body: CreateFolderRequest): Promise<Folder> {
    return this.request('POST', `${env(t)}/folders`, { body });
  }

  entries(t: Target): Promise<EntrySummary[]> {
    return this.request('GET', `${env(t)}/entries`);
  }

  createEntry(t: Target, body: CreateEntryRequest): Promise<Entry> {
    return this.request('POST', `${env(t)}/entries`, { body });
  }

  updateEntry(t: Target, id: string, data: Record<string, unknown>, message: string): Promise<Entry> {
    return this.request('PATCH', `${env(t)}/entries/${id}`, { body: { data, message } });
  }

  publishEntry(t: Target, id: string, message: string): Promise<Entry> {
    return this.request('POST', `${env(t)}/entries/${id}/publish`, { body: { message } });
  }

  // --- Media library ----------------------------------------------------------------------------

  /** Live files in a folder (its subfolders included), newest first. */
  assets(spaceId: string, folder: string): Promise<Asset[]> {
    return this.request('GET', `/v1/management/spaces/${spaceId}/assets`, { query: { folder } });
  }

  /** Step 1 of an upload: a signed URL to `PUT` the file to (see {@link putFile}). */
  assetUploadUrl(spaceId: string, body: UploadUrlRequest): Promise<UploadUrlResponse> {
    return this.request('POST', `/v1/management/spaces/${spaceId}/assets/upload-url`, { body });
  }

  /** Step 3: the API checks the uploaded file and adds it to the library. */
  completeAssetUpload(spaceId: string, body: CompleteUploadRequest): Promise<AssetDetail> {
    return this.request('POST', `/v1/management/spaces/${spaceId}/assets/complete`, { body });
  }

  /** Step 2: the file itself, to storage (the signed URL needs no other credentials). */
  async putFile(target: UploadUrlResponse, file: Blob): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': target.mime }, body: file });
    } catch (error) {
      throw new CliError(`Could not upload ${target.filename}: ${(error as Error).message}`);
    }
    if (!res.ok) throw new CliError(`Uploading ${target.filename} failed: storage answered ${res.status} ${res.statusText}.`);
  }

  // --- Plumbing ---------------------------------------------------------------------------------

  private async request<T>(method: string, path: string, options: { body?: unknown; query?: Query; auth?: boolean } = {}): Promise<T> {
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.auth !== false) headers['Authorization'] = `Bearer ${await this.token()}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    } catch (error) {
      throw new CliError(`Could not reach the Novan API at ${this.apiUrl}: ${(error as Error).message}`);
    }
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const problem = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      const code = typeof problem['code'] === 'string' ? problem['code'] : `http_${res.status}`;
      const detail = typeof problem['detail'] === 'string' ? problem['detail'] : `${method} ${path} answered ${res.status} ${res.statusText}.`;
      throw new ApiError(res.status, code, detail, problem);
    }
    return body as T;
  }
}

function env(t: Target): string {
  return `/v1/management/spaces/${t.spaceId}/environments/${t.environment}`;
}

function forceQuery(force: boolean): Query {
  return force ? { force: 'true' } : {};
}
