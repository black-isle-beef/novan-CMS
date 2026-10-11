import { isPlatformServer } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, Injector, makeStateKey, PLATFORM_ID, TransferState } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_PROXY_PATH, NOVAN_CMS_CONFIG, NOVAN_CMS_SERVER } from './config';
import { NovanApiError, toApiError } from './content.service';
import { NovanPreview } from './preview';

/** What a visitor sends through a form (`POST /v1/delivery/forms/:formUid/submit`). */
export interface NovanFormSubmission {
  /** The published page the form is on (from `NOVAN_BLOCK_CONTEXT`). */
  entryId: string;
  /** The locale the form was shown in; the site's default when left out. */
  locale?: string;
  /** Answers by field name: text, or true/false for tick boxes. */
  data: Record<string, string | boolean>;
  /** The Cloudflare Turnstile widget's answer, when the site has a site key. */
  turnstileToken?: string;
  /** The honeypot field: always empty for people. Anything in it makes the API drop the submission quietly. */
  website?: string;
}

const SITE_KEY = makeStateKey<string | null>('novan:turnstile-site-key');

/**
 * Sends forms to the Delivery API from the browser (docs/build/18-search-forms-audit.md): through the site's own server
 * (`createNovanProxy`), which adds the token and the visitor's address, or straight to the API with a
 * `publicDeliveryToken`. Forms are not sent in preview, so editors cannot fill a client's inbox by trying them.
 */
@Injectable({ providedIn: 'root' })
export class NovanForms {
  private readonly injector = inject(Injector);
  private readonly config = inject(NOVAN_CMS_CONFIG);
  private readonly preview = inject(NovanPreview);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));

  /**
   * Cloudflare Turnstile's site key for form widgets, or null for none: the server's (`provideNovanCmsServer`), else
   * `provideNovanCms`'s. The server passes it to the browser with the page, so both render the same form.
   */
  readonly turnstileSiteKey: string | null = this.siteKey();

  /** Resolves once the API has kept the answers; rejects with a {@link NovanApiError} (its `errors` by field name). */
  async submit(formUid: string, submission: NovanFormSubmission): Promise<void> {
    if (this.server) throw new NovanApiError(0, 'browser_only', 'Forms are sent from the browser.');
    if (this.preview.active()) throw new NovanApiError(0, 'preview', 'Forms are not sent while previewing.');

    const path = `delivery/forms/${encodeURIComponent(formUid)}/submit`;
    let url = `${trim(this.config.proxyPath ?? DEFAULT_PROXY_PATH)}/${path}`;
    let headers = new HttpHeaders({ Accept: 'application/json', 'Content-Type': 'application/json' });
    if (this.config.publicDeliveryToken && this.config.apiUrl) {
      url = `${trim(this.config.apiUrl)}/v1/${path}`;
      headers = headers.set('Authorization', `Bearer ${this.config.publicDeliveryToken}`);
    }
    try {
      await firstValueFrom(this.injector.get(HttpClient).post(url, submission, { headers, responseType: 'text' }));
    } catch (error) {
      throw toApiError(error);
    }
  }

  private siteKey(): string | null {
    const state = this.injector.get(TransferState);
    if (this.server) {
      const key = this.injector.get(NOVAN_CMS_SERVER, null)?.turnstileSiteKey || this.config.turnstileSiteKey || null;
      state.set(SITE_KEY, key);
      return key;
    }
    return state.get(SITE_KEY, this.config.turnstileSiteKey || null);
  }
}

function trim(url: string): string {
  return url.replace(/\/+$/, '');
}
