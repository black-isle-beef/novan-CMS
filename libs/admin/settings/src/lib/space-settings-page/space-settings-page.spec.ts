import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ManagementApi, SpaceContext } from '@novan/admin-spaces';
import type { SpaceSummary } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { SpaceSettingsPage } from './space-settings-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const space: SpaceSummary = {
  id: spaceId,
  name: 'Demo site',
  slug: 'demo-site',
  organisationId: '00000000-0000-4000-8000-000000000100',
  previewUrl: 'http://localhost:4300',
  requireApproval: false,
  role: 'admin',
  createdAt: '2026-10-01T00:00:00Z',
};

async function render(updateSpace = vi.fn((_id: string, body: { name?: string; previewUrl?: string | null }) => of({ ...space, ...body }))) {
  const spaces = signal([space]);
  const context = {
    currentSpace: computed(() => spaces()[0]),
    replace: vi.fn((updated: SpaceSummary) => spaces.set([updated])),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ManagementApi, useValue: { updateSpace } },
      { provide: SpaceContext, useValue: context },
    ],
  });
  const fixture = TestBed.createComponent(SpaceSettingsPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const fill = async (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const save = async () => {
    (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  return { fixture, el, context, updateSpace, fill, save };
}

describe('SpaceSettingsPage', () => {
  it('shows the space as it is, with nothing unsaved', async () => {
    const { el, fixture } = await render();
    expect(el.querySelector<HTMLInputElement>('#space-settings-name')?.value).toBe('Demo site');
    expect(el.querySelector<HTMLInputElement>('#space-settings-url')?.value).toBe('http://localhost:4300');
    expect(el.textContent).toContain('demo-site');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('saves a new name and site address, and the rest of the admin sees them', async () => {
    const { fill, save, updateSpace, context, fixture } = await render();
    await fill('space-settings-name', ' Demo Ltd ');
    await fill('space-settings-url', '');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    await save();

    expect(updateSpace).toHaveBeenCalledWith(spaceId, { name: 'Demo Ltd', previewUrl: null, requireApproval: false });
    expect(context.replace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Demo Ltd', previewUrl: null }));
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('turns approval before publishing on, as a labelled switch', async () => {
    const { el, save, updateSpace, fixture } = await render();
    const toggle = el.querySelector<HTMLInputElement>('#space-settings-approval') as HTMLInputElement;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.checked).toBe(false);
    expect(el.querySelector(`label[for="space-settings-approval"]`)?.textContent).toContain('need approval');
    toggle.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    await save();
    expect(updateSpace).toHaveBeenCalledWith(spaceId, expect.objectContaining({ requireApproval: true }));
  });

  it('checks the fields before saving, and ties the message to each', async () => {
    const { el, fill, save, updateSpace } = await render();
    await fill('space-settings-name', '');
    await fill('space-settings-url', 'not a web address');
    await save();

    expect(updateSpace).not.toHaveBeenCalled();
    const name = el.querySelector('#space-settings-name');
    expect(name?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector(`#${name?.getAttribute('aria-describedby')}`)?.textContent).toContain('Enter a name');
    expect(el.querySelector('#space-settings-url')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows what the API refused', async () => {
    const refused = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 400, error: { detail: 'Some fields need attention.', errors: { previewUrl: ['Enter a web address starting with https:// or http://.'] } } })),
    );
    const { el, fill, save } = await render(refused);
    await fill('space-settings-url', 'https://x');
    await save();

    expect(el.textContent).toContain('Some fields need attention.');
    expect(el.querySelector('#space-settings-url-hint')?.textContent).toContain('starting with https://');
  });
});
