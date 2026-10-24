import { isPlatformBrowser } from '@angular/common';
import { computed, DOCUMENT, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { CONSENT_COOKIE, CONSENT_MAX_AGE_DAYS, CONSENT_VERSION, type ConsentCategoryId } from '@novan/marketing-content';

/** A visitor's answer for each optional category. Strictly necessary storage is always allowed. */
export type ConsentChoices = Record<Exclude<ConsentCategoryId, 'necessary'>, boolean>;

interface StoredConsent extends ConsentChoices {
  v: number;
}

export const REJECT_ALL: ConsentChoices = { analytics: false, marketing: false };
export const ACCEPT_ALL: ConsentChoices = { analytics: true, marketing: true };

/**
 * The visitor's cookie choices, kept in the first-party `novan_consent` cookie. Until they choose, every optional
 * category counts as refused, so nothing non-essential may run. Pages are rendered and cached the same for everyone,
 * so the banner is only ever opened in the browser (`MkConsentManager` calls `init`).
 */
@Injectable({ providedIn: 'root' })
export class ConsentService {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly stored = signal<ConsentChoices | null>(null);

  /** The visitor's choices; refused for everything until they decide. */
  readonly choices = computed(() => this.stored() ?? REJECT_ALL);
  /** Whether the visitor has made a choice that is still current. */
  readonly decided = computed(() => this.stored() !== null);
  /** Whether the banner is showing. */
  readonly bannerOpen = signal(false);
  /** Whether the "Manage preferences" dialog is showing. */
  readonly preferencesOpen = signal(false);

  /** Reads the cookie and shows the banner when there is no current choice. Browser only. */
  init(): void {
    if (!this.browser) return;
    this.stored.set(this.read());
    if (!this.decided()) this.bannerOpen.set(true);
  }

  /** Whether storage in this category may be used now. */
  allows(category: ConsentCategoryId): boolean {
    return category === 'necessary' || this.choices()[category];
  }

  acceptAll(): void {
    this.save(ACCEPT_ALL);
  }

  rejectAll(): void {
    this.save(REJECT_ALL);
  }

  /** Records a choice and closes the banner and the dialog. */
  save(choices: ConsentChoices): void {
    this.stored.set({ ...choices });
    this.write({ v: CONSENT_VERSION, ...choices });
    this.preferencesOpen.set(false);
    this.bannerOpen.set(false);
  }

  /** "Cookie settings": show the banner again, with the current choice kept until a new one is made. */
  reopen(): void {
    this.bannerOpen.set(true);
  }

  private read(): ConsentChoices | null {
    const raw = this.document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(decodeURIComponent(raw.slice(CONSENT_COOKIE.length + 1)));
      if (!isStored(value) || value.v !== CONSENT_VERSION) return null;
      return { analytics: value.analytics, marketing: value.marketing };
    } catch {
      return null;
    }
  }

  private write(value: StoredConsent): void {
    if (!this.browser) return;
    const secure = this.document.location?.protocol === 'https:' ? '; Secure' : '';
    const maxAge = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60;
    this.document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
  }
}

function isStored(value: unknown): value is StoredConsent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['v'] === 'number' && typeof record['analytics'] === 'boolean' && typeof record['marketing'] === 'boolean';
}
