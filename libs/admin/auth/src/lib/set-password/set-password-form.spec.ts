import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth.service';
import { createFakeAuth, type FakeAuth } from '../testing';
import { SetPasswordForm } from './set-password-form';

describe('SetPasswordForm', () => {
  let auth: FakeAuth;

  async function fill(password: string, confirm: string) {
    const fixture = TestBed.createComponent(SetPasswordForm);
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    for (const [id, value] of [
      ['new-password', password],
      ['confirm-password', confirm],
    ]) {
      const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    return { el, saved };
  }

  beforeEach(() => {
    auth = createFakeAuth();
    TestBed.configureTestingModule({
      imports: [SetPasswordForm],
      providers: [{ provide: AuthService, useValue: auth }],
    });
  });

  it('describes the length rule and flags a short password', async () => {
    const { el } = await fill('short', 'short');

    const password = el.querySelector('#new-password')!;
    expect(password.getAttribute('aria-describedby')).toBe('new-password-hint');
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#new-password-hint')?.textContent).toContain('Use at least 8 characters');
    expect(auth.updatePassword).not.toHaveBeenCalled();
  });

  it('flags passwords that do not match', async () => {
    const { el } = await fill('long enough 1', 'long enough 2');

    expect(el.querySelector('#confirm-password-error')?.textContent).toContain('do not match');
    expect(auth.updatePassword).not.toHaveBeenCalled();
  });

  it('saves a valid password', async () => {
    const { saved } = await fill('long enough 1', 'long enough 1');

    expect(auth.updatePassword).toHaveBeenCalledWith('long enough 1');
    expect(saved).toHaveBeenCalled();
  });
});
