import { Injectable, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import type { NovanLocales } from './types';

/**
 * The locale of the page being shown (docs/build/16-localisation.md). Set while a route resolves its address; content
 * the page asks for afterwards (navigation, site settings) comes in the same locale.
 */
@Injectable({ providedIn: 'root' })
export class NovanLocale {
  /** e.g. `fr-FR`; null until an address has been resolved (the API then answers in the default locale). */
  readonly current = signal<string | null>(null);
  /** The site's locales, asked for once per app (once per request on the server, once per visit in the browser). */
  locales: Observable<NovanLocales> | null = null;
}
