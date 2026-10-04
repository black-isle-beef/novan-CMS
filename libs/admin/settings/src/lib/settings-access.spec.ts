import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type ActivatedRouteSnapshot,
  convertToParamMap,
  provideRouter,
  Router,
  type RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { AuthService } from '@novan/admin-auth';
import { requireSettingsAccess } from './settings-access';

const spaceId = '00000000-0000-4000-8000-000000000200';

function run(claims: { sub: string; agency_staff?: boolean; spaces: { id: string; role: string }[] }): boolean | UrlTree {
  const auth = { claims: signal(claims), agencyStaff: signal(claims.agency_staff === true) };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthService, useValue: auth }] });
  const route = { paramMap: convertToParamMap({ spaceId }) } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(
    () => requireSettingsAccess(route, {} as RouterStateSnapshot) as boolean | UrlTree,
  );
}

describe('requireSettingsAccess', () => {
  it.each(['admin', 'developer'])('lets a space %s in', (role) => {
    expect(run({ sub: 'u', spaces: [{ id: spaceId, role }] })).toBe(true);
  });

  it('lets agency staff in without membership', () => {
    expect(run({ sub: 'u', agency_staff: true, spaces: [] })).toBe(true);
  });

  it.each(['editor', 'author', 'viewer'])('sends a space %s to the space home', (role) => {
    const result = run({ sub: 'u', spaces: [{ id: spaceId, role }] });

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(`/spaces/${spaceId}`);
  });
});
