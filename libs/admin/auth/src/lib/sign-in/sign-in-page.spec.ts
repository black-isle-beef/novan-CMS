import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { createFakeAuth, type FakeAuth } from '../testing';
import { SignInPage } from './sign-in-page';

describe('SignInPage', () => {
  let auth: FakeAuth;

  async function render(returnUrl?: string) {
    const fixture = TestBed.createComponent(SignInPage);
    if (returnUrl) fixture.componentRef.setInput('returnUrl', returnUrl);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const input = (el: HTMLElement, label: string): HTMLInputElement => {
    const id = [...el.querySelectorAll('label')].find((l) => l.textContent?.trim() === label)?.htmlFor;
    return el.querySelector(`#${id}`) as HTMLInputElement;
  };

  const type = (field: HTMLInputElement, value: string): void => {
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };

  const submit = async (el: HTMLElement): Promise<void> => {
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await TestBed.inject(Router).navigated;
    await new Promise((resolve) => setTimeout(resolve));
  };

  beforeEach(() => {
    auth = createFakeAuth();
    TestBed.configureTestingModule({
      imports: [SignInPage],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
  });

  it('has one main landmark, a heading and labelled fields', async () => {
    const el = await render();

    expect(el.querySelectorAll('main#ds-main-content')).toHaveLength(1);
    expect(el.querySelector('h1')?.textContent).toContain('Sign in');
    expect(input(el, 'Email').autocomplete).toBe('username');
    expect(input(el, 'Password').type).toBe('password');
  });

  it('flags empty fields without calling Supabase', async () => {
    const el = await render();

    await submit(el);
    TestBed.tick();

    expect(input(el, 'Email').getAttribute('aria-invalid')).toBe('true');
    expect(input(el, 'Email').getAttribute('aria-describedby')).toBe('sign-in-email-error');
    expect(el.querySelector('#sign-in-email-error')?.textContent).toContain('Enter your email address');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in and goes to the return URL', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const el = await render('/spaces/abc');

    type(input(el, 'Email'), ' agency@novan.test ');
    type(input(el, 'Password'), 'password123');
    await submit(el);

    expect(auth.signInWithPassword).toHaveBeenCalledWith('agency@novan.test', 'password123');
    expect(navigate).toHaveBeenCalledWith('/spaces/abc');
  });

  it('shows a plain-language error when the password is wrong', async () => {
    auth.signInWithPassword.mockRejectedValue({ code: 'invalid_credentials' });
    const el = await render();

    type(input(el, 'Email'), 'agency@novan.test');
    type(input(el, 'Password'), 'nope');
    await submit(el);
    TestBed.tick();

    expect(el.querySelector('ds-alert')?.textContent).toContain('Your email or password is incorrect.');
  });

  it('can email a sign-in link instead', async () => {
    const el = await render();

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Email me a sign-in link instead'))?.click();
    TestBed.tick();
    expect(input(el, 'Password')).toBeNull();

    type(input(el, 'Email'), 'client@novan.test');
    await submit(el);
    TestBed.tick();

    expect(auth.sendMagicLink).toHaveBeenCalledWith('client@novan.test');
    expect(el.querySelector('ds-alert')?.textContent).toContain('We have sent a sign-in link to client@novan.test');
  });
});
