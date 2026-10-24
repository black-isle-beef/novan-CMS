import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DEFAULT_PROXY_PATH, type NovanFormSubmission } from '@black-isle-beef/cms-angular';
import { firstValueFrom } from 'rxjs';
import type { ContactFormTarget } from '../../config/site-config';

/** Why an enquiry was not kept: the API's answers by field name, when it checked them. */
export class ContactError extends Error {
  constructor(
    readonly status: number,
    readonly fieldErrors: Readonly<Record<string, readonly string[]>>,
  ) {
    super(`The enquiry was not sent (${status}).`);
  }
}

/**
 * Sends an enquiry to the Forms feature through this site's server (`server.ts`), which adds the Novan space's
 * delivery token and the visitor's address for the API's rate limits.
 */
@Injectable({ providedIn: 'root' })
export class ContactService {
  private readonly http = inject(HttpClient);

  async send(target: ContactFormTarget, data: NovanFormSubmission['data'], website: string): Promise<void> {
    const body: NovanFormSubmission = { entryId: target.entryId, locale: 'en-GB', data, website };
    const url = `${DEFAULT_PROXY_PATH}/delivery/forms/${encodeURIComponent(target.formUid)}/submit`;
    const headers = new HttpHeaders({ Accept: 'application/json', 'Content-Type': 'application/json' });
    try {
      await firstValueFrom(this.http.post(url, body, { headers, responseType: 'text' }));
    } catch (error) {
      throw toContactError(error);
    }
  }
}

function toContactError(error: unknown): ContactError {
  if (!(error instanceof HttpErrorResponse)) return new ContactError(0, {});
  let problem: unknown = error.error;
  if (typeof problem === 'string') {
    try {
      problem = JSON.parse(problem);
    } catch {
      problem = null;
    }
  }
  const errors = typeof problem === 'object' && problem !== null ? (problem as Record<string, unknown>)['errors'] : null;
  const fieldErrors: Record<string, string[]> = {};
  if (typeof errors === 'object' && errors !== null) {
    for (const [field, messages] of Object.entries(errors)) {
      if (Array.isArray(messages)) fieldErrors[field] = messages.filter((message): message is string => typeof message === 'string');
    }
  }
  return new ContactError(error.status, fieldErrors);
}
