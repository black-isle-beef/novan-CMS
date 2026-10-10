import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type {
  ApiToken,
  CreateApiTokenRequest,
  CreatedApiToken,
  CreateRedirectRequest,
  ImportRedirectsRequest,
  ImportRedirectsResult,
  NotFoundQuery,
  NotFoundSummary,
  Redirect,
  UpdateRedirectRequest,
  CreateWebhookRequest,
  UpdateWebhookRequest,
  Webhook,
  WebhookDelivery,
  WebhookWithSecret,
} from '@novan/shared-schemas';
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

  listWebhooks(spaceId: string): Observable<Webhook[]> {
    return this.http.get<Webhook[]>(`${this.base}/${spaceId}/webhooks`);
  }

  /** The response carries the webhook's secret; this is the only time it is sent. */
  createWebhook(spaceId: string, body: CreateWebhookRequest): Observable<WebhookWithSecret> {
    return this.http.post<WebhookWithSecret>(`${this.base}/${spaceId}/webhooks`, body);
  }

  updateWebhook(spaceId: string, id: string, body: UpdateWebhookRequest): Observable<Webhook> {
    return this.http.patch<Webhook>(`${this.base}/${spaceId}/webhooks/${id}`, body);
  }

  /** The response carries the new secret; this is the only time it is sent. */
  rotateWebhookSecret(spaceId: string, id: string): Observable<WebhookWithSecret> {
    return this.http.post<WebhookWithSecret>(`${this.base}/${spaceId}/webhooks/${id}/rotate-secret`, {});
  }

  deleteWebhook(spaceId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${spaceId}/webhooks/${id}`);
  }

  webhookDeliveries(spaceId: string, id: string): Observable<WebhookDelivery[]> {
    return this.http.get<WebhookDelivery[]>(`${this.base}/${spaceId}/webhooks/${id}/deliveries`);
  }

  resendWebhookDelivery(spaceId: string, id: string, deliveryId: string): Observable<WebhookDelivery> {
    return this.http.post<WebhookDelivery>(`${this.base}/${spaceId}/webhooks/${id}/deliveries/${deliveryId}/resend`, {});
  }

  testWebhook(spaceId: string, id: string): Observable<WebhookDelivery> {
    return this.http.post<WebhookDelivery>(`${this.base}/${spaceId}/webhooks/${id}/test`, {});
  }

  // --- Redirects and missing pages (docs/build/14-seo-site-features.md) ---

  listRedirects(spaceId: string): Observable<Redirect[]> {
    return this.http.get<Redirect[]>(`${this.base}/${spaceId}/redirects`);
  }

  createRedirect(spaceId: string, body: CreateRedirectRequest): Observable<Redirect> {
    return this.http.post<Redirect>(`${this.base}/${spaceId}/redirects`, body);
  }

  updateRedirect(spaceId: string, id: string, body: UpdateRedirectRequest): Observable<Redirect> {
    return this.http.patch<Redirect>(`${this.base}/${spaceId}/redirects/${id}`, body);
  }

  deleteRedirect(spaceId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${spaceId}/redirects/${id}`);
  }

  importRedirects(spaceId: string, body: ImportRedirectsRequest): Observable<ImportRedirectsResult> {
    return this.http.post<ImportRedirectsResult>(`${this.base}/${spaceId}/redirects/import`, body);
  }

  /** Addresses visitors found no page at, most visited first. */
  listNotFound(spaceId: string, query: NotFoundQuery = {}): Observable<NotFoundSummary[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params = params.set(key, String(value));
    return this.http.get<NotFoundSummary[]>(`${this.base}/${spaceId}/not-found`, { params });
  }
}
