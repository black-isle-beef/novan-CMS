// components/form/turnstile.ts — loads Cloudflare Turnstile in the browser, once, for form blocks.
import { DOCUMENT } from '@angular/common';
import { inject, InjectionToken } from '@angular/core';

/** The parts of Cloudflare Turnstile's browser API a form uses. */
export interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      language?: string;
      theme?: 'light' | 'dark' | 'auto';
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Loads Turnstile's script; replaced in tests. */
export const TURNSTILE_LOADER = new InjectionToken<() => Promise<TurnstileApi>>('TURNSTILE_LOADER', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    let loading: Promise<TurnstileApi> | null = null;
    return () =>
      (loading ??= new Promise<TurnstileApi>((resolve, reject) => {
        const window = document.defaultView as (Window & { turnstile?: TurnstileApi }) | null;
        if (window?.turnstile) {
          resolve(window.turnstile);
          return;
        }
        const script = document.createElement('script');
        script.src = SCRIPT;
        script.async = true;
        script.onload = () => (window?.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')));
        script.onerror = () => {
          loading = null;
          reject(new Error('Turnstile could not be loaded'));
        };
        document.head.appendChild(script);
      }));
  },
});
