import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { DsToastService } from '@black-isle-beef/novan-design-system';
import { ViewAs } from '@novan/admin-auth';
import { ManagementApi } from '@novan/admin-spaces';
import { of, throwError } from 'rxjs';
import { article, ViewAsControl } from './view-as-control';

const spaceId = '00000000-0000-4000-8000-000000000200';

const last = (toasts: DsToastService) => toasts.toasts()[toasts.toasts().length - 1];

function setup(viewAs = vi.fn(() => of(undefined))) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ManagementApi, useValue: { viewAs } }] });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { control: TestBed.inject(ViewAsControl), state: TestBed.inject(ViewAs), toasts: TestBed.inject(DsToastService), viewAs, navigate };
}

describe('ViewAsControl', () => {
  it('audits first, then views the space as the role from its dashboard', async () => {
    const { control, state, toasts, viewAs, navigate } = setup();
    await control.start(spaceId, 'author');

    expect(viewAs).toHaveBeenCalledWith(spaceId, 'author');
    expect(state.current()).toEqual({ spaceId, role: 'author' });
    expect(navigate).toHaveBeenCalledWith(['/spaces', spaceId]);
    expect(last(toasts)?.message).toBe('You are viewing this space as an Author. Changes are turned off.');
  });

  it('does not start when the audit record cannot be written', async () => {
    const { control, state, toasts } = setup(vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403, error: { detail: 'Only agency staff can do this.' } }))));
    await control.start(spaceId, 'editor');

    expect(state.current()).toBeNull();
    expect(last(toasts)).toMatchObject({ variant: 'danger', message: 'Only agency staff can do this.' });
  });

  it('stops at once, and records it', async () => {
    const { control, state, viewAs } = setup();
    state.start(spaceId, 'viewer');
    await control.stop();

    expect(state.current()).toBeNull();
    expect(viewAs).toHaveBeenCalledWith(spaceId, null);
  });

  it('says "a" or "an"', () => {
    expect([article('Admin'), article('Editor'), article('Viewer'), article('developer')]).toEqual([
      'an Admin',
      'an Editor',
      'a Viewer',
      'a developer',
    ]);
  });
});
