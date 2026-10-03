import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { Factor } from '@supabase/supabase-js';
import { AuthService } from '../auth.service';
import { createFakeAuth, type FakeAuth } from '../testing';
import { TwoStepPage } from './two-step-page';

describe('TwoStepPage', () => {
  let auth: FakeAuth;

  async function render() {
    const fixture = TestBed.createComponent(TwoStepPage);
    fixture.componentRef.setInput('returnUrl', '/spaces');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    auth = createFakeAuth();
    TestBed.configureTestingModule({
      imports: [TwoStepPage],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
  });

  it('asks for a code when an authenticator app is set up, then continues', async () => {
    auth.verifiedTotpFactors.mockResolvedValue([{ id: 'factor-1', status: 'verified' } as Factor]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const el = await render();

    const code = el.querySelector<HTMLInputElement>('#challenge-code');
    expect(el.querySelector('label[for=challenge-code]')?.textContent).toContain('6-digit code');
    expect(code?.autocomplete).toBe('one-time-code');

    code!.value = '123456';
    code!.dispatchEvent(new Event('input'));
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/spaces'));

    expect(auth.verifyTotp).toHaveBeenCalledWith('factor-1', '123456');
  });

  it('rejects a code that is not 6 digits', async () => {
    auth.verifiedTotpFactors.mockResolvedValue([{ id: 'factor-1', status: 'verified' } as Factor]);
    const el = await render();

    const code = el.querySelector<HTMLInputElement>('#challenge-code')!;
    code.value = '12ab';
    code.dispatchEvent(new Event('input'));
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    TestBed.tick();

    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(auth.verifyTotp).not.toHaveBeenCalled();
  });

  it('makes users without an authenticator app add one', async () => {
    auth.enrolTotp.mockResolvedValue({ factorId: 'new', qrCode: 'data:image/svg+xml;utf8,<svg/>', secret: 'ABC123' });
    const el = await render();
    await vi.waitFor(() => expect(el.querySelector('img')).not.toBeNull());

    expect(el.textContent).toContain('Your account needs two-step verification');
    expect(el.querySelector('img')?.getAttribute('alt')).toContain('QR code');
    expect(el.querySelector('code')?.textContent).toBe('ABC123');
  });
});
