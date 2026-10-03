import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '@novan/admin-auth';
import { appRoutes } from './app.routes';

describe('App routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(appRoutes),
        {
          provide: AuthService,
          useValue: {
            whenReady: () => Promise.resolve(),
            signedIn: signal(false),
            needsSecondFactor: computed(() => false),
            agencyStaff: computed(() => false),
          },
        },
      ],
    });
  });

  it('sends signed-out visitors from the root to the sign-in page', async () => {
    const harness = await RouterTestingHarness.create('/');
    const compiled = harness.routeNativeElement as HTMLElement;

    expect(TestBed.inject(Router).url).toBe('/sign-in?returnUrl=%2Fspaces');
    expect(compiled.querySelector('ds-header')).not.toBeNull();
    expect(compiled.querySelector('main#ds-main-content h1')?.textContent).toContain('Sign in');
  });

  it('keeps a deep link as the return URL', async () => {
    await RouterTestingHarness.create('/spaces/abc/members');

    expect(TestBed.inject(Router).url).toBe('/sign-in?returnUrl=%2Fspaces%2Fabc%2Fmembers');
  });
});
