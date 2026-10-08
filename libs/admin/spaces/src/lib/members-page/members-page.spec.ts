import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@novan/admin-auth';
import type { Member, SpaceSummary } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { ManagementApi } from '../management-api';
import { SpaceContext } from '../space-context';
import { MembersPage } from './members-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const me = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';

const members: Member[] = [
  { userId: me, displayName: 'Agency User', role: 'admin', invitedBy: null, createdAt: '' },
  { userId: other, displayName: 'Client User', role: 'editor', invitedBy: me, createdAt: '' },
];

describe('MembersPage', () => {
  let api: {
    listMembers: ReturnType<typeof vi.fn>;
    invite: ReturnType<typeof vi.fn>;
    changeRole: ReturnType<typeof vi.fn>;
    removeMember: ReturnType<typeof vi.fn>;
  };

  async function render(role: SpaceSummary['role']) {
    const spaces = signal<SpaceSummary[] | null>([
      { id: spaceId, name: 'Demo site', slug: 'demo-site', organisationId: spaceId, previewUrl: null, requireApproval: false, role, createdAt: '' },
    ]);
    const currentSpaceId = signal<string | null>(null);
    const currentSpace = computed(() => spaces()?.find((s) => s.id === currentSpaceId()) ?? null);
    TestBed.configureTestingModule({
      imports: [MembersPage],
      providers: [
        { provide: ManagementApi, useValue: api },
        {
          provide: AuthService,
          useValue: { claims: signal({ sub: me }), agencyStaff: signal(false) },
        },
        {
          provide: SpaceContext,
          useValue: {
            spaces,
            currentSpaceId,
            currentSpace,
            canManageCurrent: computed(() => currentSpace()?.role === 'admin'),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(MembersPage);
    fixture.componentRef.setInput('spaceId', spaceId);
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    api = {
      listMembers: vi.fn().mockReturnValue(of(members)),
      invite: vi.fn(),
      changeRole: vi.fn(),
      removeMember: vi.fn().mockReturnValue(of(undefined)),
    };
  });

  it('lists people in a captioned table with row headers', async () => {
    const el = (await render('editor')).nativeElement as HTMLElement;

    expect(api.listMembers).toHaveBeenCalledWith(spaceId);
    expect(el.querySelector('caption')?.textContent).toContain('People with access');
    expect([...el.querySelectorAll('tbody th[scope=row]')].map((th) => th.textContent?.trim())).toEqual([
      'Agency User You',
      'Client User',
    ]);
    expect(el.textContent).toContain('Who can sign in to Demo site');
  });

  it('hides management controls from non-admins', async () => {
    const el = (await render('editor')).nativeElement as HTMLElement;

    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('#invite-heading')).toBeNull();
    expect(el.textContent).toContain('Editor');
  });

  it('gives admins labelled role selects, named remove buttons and the invite form', async () => {
    const el = (await render('admin')).nativeElement as HTMLElement;

    expect(el.querySelector(`label[for=role-${other}]`)?.textContent).toContain('Role for Client User');
    expect(el.querySelector<HTMLSelectElement>(`#role-${other}`)?.value).toBe('editor');
    expect([...el.querySelectorAll('button')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toContain(
      'Remove Client User',
    );
    expect(el.querySelector('fieldset legend')?.textContent).toContain('Role');
  });

  it('invites someone and announces it', async () => {
    api.invite.mockReturnValue(
      of({ userId: 'new', displayName: 'new@example.test', role: 'viewer', invitedBy: me, createdAt: '' }),
    );
    const fixture = await render('admin');
    const el = fixture.nativeElement as HTMLElement;

    const email = el.querySelector<HTMLInputElement>('#invite-email')!;
    email.value = 'new@example.test';
    email.dispatchEvent(new Event('input'));
    el.querySelector<HTMLInputElement>('#invite-role-viewer')!.click();
    el.querySelector('section form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(api.invite).toHaveBeenCalledWith(spaceId, { email: 'new@example.test', role: 'viewer' });
    expect(el.querySelector('ds-alert')?.textContent).toContain('Invited new@example.test as viewer.');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('shows the API reason and restores the select when a role change is refused', async () => {
    api.changeRole.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'last_admin', detail: 'A space needs at least one admin.' },
          }),
      ),
    );
    const fixture = await render('admin');
    const el = fixture.nativeElement as HTMLElement;

    const select = el.querySelector<HTMLSelectElement>(`#role-${me}`)!;
    select.value = 'viewer';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(el.querySelector('ds-alert')?.textContent).toContain('A space needs at least one admin.');
    expect(select.value).toBe('admin');
  });
});
