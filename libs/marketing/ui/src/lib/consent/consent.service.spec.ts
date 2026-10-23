import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CONSENT_COOKIE } from '@novan/marketing-content';
import { ConsentService } from './consent.service';

function clearCookie(): void {
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
}

function storedCookie(): unknown {
  const raw = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  return raw ? JSON.parse(decodeURIComponent(raw.slice(CONSENT_COOKIE.length + 1))) : null;
}

describe('ConsentService', () => {
  beforeEach(() => clearCookie());
  afterEach(() => clearCookie());

  it('refuses every optional category until the visitor chooses, and opens the banner', () => {
    const consent = TestBed.inject(ConsentService);
    consent.init();

    expect(consent.decided()).toBe(false);
    expect(consent.bannerOpen()).toBe(true);
    expect(consent.allows('necessary')).toBe(true);
    expect(consent.allows('analytics')).toBe(false);
    expect(consent.allows('marketing')).toBe(false);
    expect(storedCookie()).toBeNull();
  });

  it('records Reject all and Accept all in the first-party cookie and closes the banner', () => {
    const consent = TestBed.inject(ConsentService);
    consent.init();

    consent.rejectAll();
    expect(storedCookie()).toEqual({ v: 1, analytics: false, marketing: false });
    expect(consent.bannerOpen()).toBe(false);
    expect(consent.decided()).toBe(true);

    consent.acceptAll();
    expect(storedCookie()).toEqual({ v: 1, analytics: true, marketing: true });
    expect(consent.allows('analytics')).toBe(true);
  });

  it('saves a choice per category and closes the preferences dialog', () => {
    const consent = TestBed.inject(ConsentService);
    consent.preferencesOpen.set(true);
    consent.save({ analytics: true, marketing: false });

    expect(storedCookie()).toEqual({ v: 1, analytics: true, marketing: false });
    expect(consent.preferencesOpen()).toBe(false);
    expect(consent.allows('marketing')).toBe(false);
  });

  it('keeps a stored choice on the next visit, so the banner stays closed', () => {
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify({ v: 1, analytics: true, marketing: false }))}; Path=/`;
    const consent = TestBed.inject(ConsentService);
    consent.init();

    expect(consent.decided()).toBe(true);
    expect(consent.bannerOpen()).toBe(false);
    expect(consent.allows('analytics')).toBe(true);
  });

  it('asks again when the stored choice is from an older version or unreadable', () => {
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify({ v: 0, analytics: true, marketing: true }))}; Path=/`;
    const consent = TestBed.inject(ConsentService);
    consent.init();
    expect(consent.decided()).toBe(false);
    expect(consent.allows('analytics')).toBe(false);

    document.cookie = `${CONSENT_COOKIE}=not-json; Path=/`;
    consent.init();
    expect(consent.decided()).toBe(false);
  });

  it('reopens the banner from "Cookie settings" without forgetting the choice', () => {
    const consent = TestBed.inject(ConsentService);
    consent.init();
    consent.acceptAll();
    consent.reopen();

    expect(consent.bannerOpen()).toBe(true);
    expect(consent.allows('analytics')).toBe(true);
  });

  it('does nothing on the server: pages are cached the same for everyone', () => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const consent = TestBed.inject(ConsentService);
    consent.init();
    consent.acceptAll();

    expect(consent.bannerOpen()).toBe(false);
    expect(storedCookie()).toBeNull();
  });
});
