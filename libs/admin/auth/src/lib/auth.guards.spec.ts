import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  type ActivatedRouteSnapshot,
  Router,
  type RouterStateSnapshot,
  type UrlTree,
} from '@angular/router';
import { requireAgencyStaff, requireSignedIn, requireSignedOut, safeReturnUrl } from './auth.guards';
import { AuthService } from './auth.service';
import { createFakeAuth, type FakeAuth, fakeSession } from './testing';

describe('auth guards', () => {
  let auth: FakeAuth;

  const run = (guard: typeof requireSignedIn, url = '/spaces') =>
    TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
  const serialize = (result: unknown): string => TestBed.inject(Router).serializeUrl(result as UrlTree);

  beforeEach(() => {
    auth = createFakeAuth();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthService, useValue: auth }] });
  });

  it('sends signed-out visitors to sign in, keeping where they were going', async () => {
    expect(serialize(await run(requireSignedIn, '/spaces/abc'))).toBe('/sign-in?returnUrl=%2Fspaces%2Fabc');
  });

  it('sends agency staff without a second factor to two-step verification', async () => {
    auth.session.set(fakeSession({ sub: 'u', agency_staff: true, aal: 'aal1' }));

    expect(serialize(await run(requireSignedIn))).toBe('/two-step?returnUrl=%2Fspaces');
  });

  it('lets agency staff at AAL2 and clients at AAL1 in', async () => {
    auth.session.set(fakeSession({ sub: 'u', agency_staff: true, aal: 'aal2' }));
    expect(await run(requireSignedIn)).toBe(true);

    auth.session.set(fakeSession({ sub: 'u', aal: 'aal1' }));
    expect(await run(requireSignedIn)).toBe(true);
  });

  it('keeps signed-in users away from the sign-in page', async () => {
    expect(await run(requireSignedOut)).toBe(true);

    auth.session.set(fakeSession({ sub: 'u' }));
    expect(serialize(await run(requireSignedOut))).toBe('/');
  });

  it('only lets agency staff create spaces', () => {
    auth.session.set(fakeSession({ sub: 'u' }));
    expect(serialize(run(requireAgencyStaff))).toBe('/');

    auth.session.set(fakeSession({ sub: 'u', agency_staff: true, aal: 'aal2' }));
    expect(run(requireAgencyStaff)).toBe(true);
  });

  it.each([
    ['/spaces/1', '/spaces/1'],
    [undefined, '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
  ])('safeReturnUrl(%s) is %s', (value, expected) => {
    expect(safeReturnUrl(value)).toBe(expected);
  });
});
