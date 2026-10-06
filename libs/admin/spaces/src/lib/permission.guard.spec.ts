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
import { AuthService, ViewAs } from '@novan/admin-auth';
import { requirePermission } from './permission.guard';
import type { Permission } from './permissions';

const spaceId = '00000000-0000-4000-8000-000000000200';

function run(permission: Permission, claims: { agency_staff?: boolean; spaces: { id: string; role: string }[] }, viewingAs?: 'editor') {
  TestBed.resetTestingModule();
  const auth = { claims: signal({ sub: 'u', ...claims }), agencyStaff: signal(claims.agency_staff === true) };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthService, useValue: auth }] });
  if (viewingAs) TestBed.inject(ViewAs).start(spaceId, viewingAs);
  const route = { paramMap: convertToParamMap({ spaceId }) } as ActivatedRouteSnapshot;
  const result = TestBed.runInInjectionContext(() => requirePermission(permission)(route, {} as RouterStateSnapshot)) as boolean | UrlTree;
  return result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result;
}

describe('requirePermission', () => {
  it('mirrors the menu: client roles reach the client screens only', () => {
    const editor = { spaces: [{ id: spaceId, role: 'editor' }] };
    expect(run('content.read', editor)).toBe(true);
    expect(run('space.read', editor)).toBe(true);
    expect(run('schema.write', editor)).toBe(`/spaces/${spaceId}`);
    expect(run('settings.update', editor)).toBe(`/spaces/${spaceId}`);
  });

  it('lets a developer change the model and tokens, but not read the audit log or rename the space', () => {
    const developer = { spaces: [{ id: spaceId, role: 'developer' }] };
    expect(run('schema.write', developer)).toBe(true);
    expect(run('settings.update', developer)).toBe(true);
    expect(run('audit.read', developer)).toBe(`/spaces/${spaceId}`);
    expect(run('space.update', developer)).toBe(`/spaces/${spaceId}`);
  });

  it('lets agency staff in anywhere, unless they are viewing the space as a client role', () => {
    expect(run('audit.read', { agency_staff: true, spaces: [] })).toBe(true);
    expect(run('schema.write', { agency_staff: true, spaces: [] }, 'editor')).toBe(`/spaces/${spaceId}`);
    expect(run('content.read', { agency_staff: true, spaces: [] }, 'editor')).toBe(true);
  });

  it('keeps out someone who is not in the space', () => {
    expect(run('content.read', { spaces: [] })).toBe(`/spaces/${spaceId}`);
  });
});
