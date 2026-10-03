import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from './app.routes';

describe('App routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(appRoutes)],
    });
  });

  it('redirects the root path to the sign-in page', async () => {
    const harness = await RouterTestingHarness.create('/');
    const compiled = harness.routeNativeElement as HTMLElement;

    expect(compiled.querySelector('ds-header')).not.toBeNull();
    expect(compiled.querySelector('main#ds-main-content h1')?.textContent).toContain('Sign in');
  });
});
