import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import axe from 'axe-core';
import { ADMIN_CONFIG } from '../admin-config';
import { AuthService } from '../auth.service';
import { createFakeAuth, fakeSession } from '../testing';
import { DevicePage } from './device-page';

const decideUrl = 'http://api.test/v1/management/device-authorizations/decide';

describe('DevicePage', () => {
  function setup(query: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [DevicePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ADMIN_CONFIG, useValue: { apiUrl: 'http://api.test' } },
        { provide: AuthService, useValue: createFakeAuth(fakeSession({ sub: 'u1', aal: 'aal1' })) },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    });
    const fixture = TestBed.createComponent(DevicePage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = () => el.querySelector<HTMLInputElement>('#device-code') as HTMLInputElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
    return { fixture, el, input, button, http: TestBed.inject(HttpTestingController) };
  }

  it('fills in the code from the link the CLI opened', () => {
    const { input } = setup({ code: 'bcdfghjk' });

    expect(input().value).toBe('BCDF-GHJK');
  });

  it('ignores a malformed code in the link', () => {
    const { input } = setup({ code: '<script>' });

    expect(input().value).toBe('');
  });

  it('approves the code and says what happened', async () => {
    const { fixture, el, button, http } = setup({ code: 'BCDF-GHJK' });

    button('Approve sign-in').click();
    const req = http.expectOne(decideUrl);
    expect(req.request.body).toEqual({ userCode: 'BCDF-GHJK', approve: true });
    req.flush({ status: 'approved' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).toContain('The CLI is signed in as user@example.test');
    expect(el.querySelector('form')).toBeNull();
  });

  it('denies the code', async () => {
    const { fixture, el, button, http } = setup({ code: 'BCDF-GHJK' });

    button('Deny').click();
    http.expectOne(decideUrl).flush({ status: 'denied' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).toContain('Sign-in denied');
  });

  it('marks a malformed code without asking the API', () => {
    const { fixture, input, button, http } = setup();

    input().value = 'ABC';
    input().dispatchEvent(new Event('input'));
    button('Approve sign-in').click();
    fixture.detectChanges();

    http.expectNone(decideUrl);
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it("shows the API's message for an expired code", async () => {
    const { fixture, el, button, http } = setup({ code: 'BCDF-GHJK' });

    button('Approve sign-in').click();
    http
      .expectOne(decideUrl)
      .flush({ code: 'device_code_not_found', detail: 'This code is not right, has expired or was already used.' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).toContain('has expired or was already used');
  });

  it('has no axe violations', async () => {
    const { el } = setup({ code: 'BCDF-GHJK' });

    const results = await axe.run(el);
    expect(results.violations).toEqual([]);
  });
});
