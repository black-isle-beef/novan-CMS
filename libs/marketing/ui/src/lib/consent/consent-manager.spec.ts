import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CONSENT_COOKIE } from '@novan/marketing-content';
import axe from 'axe-core';
import { MkConsentManager } from './consent-manager';
import { ConsentService } from './consent.service';

// jsdom has no modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

describe('MkConsentManager', () => {
  beforeEach(() => {
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
    TestBed.configureTestingModule({ imports: [MkConsentManager], providers: [provideRouter([])] });
  });

  async function render() {
    const fixture = TestBed.createComponent(MkConsentManager);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement, consent: TestBed.inject(ConsentService) };
  }

  it('shows the banner to a visitor who has not chosen, with equal Accept all and Reject all', async () => {
    const { host } = await render();
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('.ds-cookie-banner__actions button'));

    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Manage preferences', 'Reject all', 'Accept all']);
    expect(buttons[1].classList).toContain('btn-primary');
    expect(buttons[2].classList).toContain('btn-primary');
    expect(host.querySelector('#ds-cookie-banner-message a')?.getAttribute('href')).toBe('/cookies');
    expect(host.contains(document.activeElement)).toBe(false);
  });

  it('records Reject all and closes the banner', async () => {
    const { fixture, host, consent } = await render();
    Array.from(host.querySelectorAll<HTMLButtonElement>('.ds-cookie-banner__actions button'))[1].click();
    fixture.detectChanges();

    expect(consent.decided()).toBe(true);
    expect(consent.allows('analytics')).toBe(false);
    expect(host.querySelector('.ds-cookie-banner__region')).toBeNull();
  });

  it('lets the visitor choose categories, with strictly necessary always on', async () => {
    const { fixture, host, consent } = await render();
    host.querySelector<HTMLButtonElement>('.ds-cookie-banner__actions button')!.click();
    fixture.detectChanges();
    expect(consent.preferencesOpen()).toBe(true);

    const necessary = host.querySelector<HTMLInputElement>('#mk-consent-necessary')!;
    const analytics = host.querySelector<HTMLInputElement>('#mk-consent-analytics')!;
    expect(necessary.checked).toBe(true);
    expect(necessary.disabled).toBe(true);
    expect(analytics.checked).toBe(false);

    analytics.click();
    host.querySelector<HTMLFormElement>('#mk-consent-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();

    expect(consent.choices()).toEqual({ analytics: true, marketing: false });
    expect(consent.preferencesOpen()).toBe(false);
    expect(consent.bannerOpen()).toBe(false);
  });

  it('has no axe violations', async () => {
    const { host } = await render();
    const results = await axe.run(host, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
