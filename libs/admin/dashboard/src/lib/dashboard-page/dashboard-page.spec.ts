import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ContentApi } from '@novan/admin-content';
import { Confirm } from '@novan/admin-shell';
import { ManagementApi, SpaceContext } from '@novan/admin-spaces';
import type { EntrySummary, Onboarding } from '@novan/shared-schemas';
import { of } from 'rxjs';
import { DashboardPage } from './dashboard-page';

const spaceId = '00000000-0000-4000-8000-000000000200';

const page = (id: string, title: string, updatedAt: string, extra: Partial<EntrySummary> = {}): EntrySummary => ({
  id,
  contentType: 'page',
  contentTypeName: 'Page',
  kind: 'page',
  folderId: null,
  slug: title.toLowerCase(),
  path: `/${title.toLowerCase()}`,
  locale: 'en-GB',
  title,
  status: 'published',
  hasUnpublishedChanges: false,
  createdAt: updatedAt,
  updatedAt,
  publishedAt: updatedAt,
  deletedAt: null,
  ...extra,
});

const entries = [
  page('1', 'Home', '2026-10-01T10:00:00Z', { slug: 'home' }),
  page('2', 'About', '2026-10-05T10:00:00Z', { hasUnpublishedChanges: true }),
  page('3', 'Contact', '2026-10-03T10:00:00Z', { status: 'draft', publishedAt: null }),
  page('4', 'Site settings', '2026-10-06T10:00:00Z', { kind: 'singleton', contentType: 'siteSettings' }),
];

async function render({ canEdit = true, checklist = null as Onboarding | null } = {}) {
  const management = {
    onboarding: vi.fn(() => of({ checklist })),
    dismissOnboarding: vi.fn(() => of({ checklist: checklist && { ...checklist, dismissedAt: '2026-10-06T12:00:00Z' } })),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ContentApi, useValue: { listEntries: vi.fn(() => of(entries)) } },
      { provide: ManagementApi, useValue: management },
      { provide: SpaceContext, useValue: { currentSpace: signal({ name: 'Demo site' }), canEditCurrent: signal(canEdit) } },
    ],
  });
  const fixture = TestBed.createComponent(DashboardPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  const settle = async () => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const section = (heading: string) => el.querySelector(`section[aria-labelledby="${heading}"]`) as HTMLElement;
  const links = (heading: string) => [...section(heading).querySelectorAll('li a')].map((a) => a.textContent?.trim());
  return { fixture, el, management, section, links, settle };
}

describe('DashboardPage', () => {
  it('lists recently edited pages, newest first, and the drafts awaiting review', async () => {
    const { el, links } = await render();
    expect(el.querySelector('h1')?.textContent).toBe('Dashboard');
    expect(links('recent-heading')).toEqual(['About', 'Contact', 'Home']);
    expect(links('drafts-heading')).toEqual(['About', 'Contact']);
    expect(el.querySelector('section[aria-labelledby="drafts-heading"]')?.textContent).toContain('Changes not published');
  });

  it('offers a New page shortcut to people who can add pages', async () => {
    const editor = await render();
    const link = [...editor.el.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'New page');
    expect(link?.getAttribute('href')).toBe(`/spaces/${spaceId}/content?add=page`);
    TestBed.resetTestingModule();

    const viewer = await render({ canEdit: false });
    expect([...viewer.el.querySelectorAll('a')].some((a) => a.textContent?.trim() === 'New page')).toBe(false);
  });

  it('shows no checklist for a space without one, or once it is dismissed', async () => {
    expect((await render()).el.querySelector('nv-onboarding-checklist')).toBeNull();
    TestBed.resetTestingModule();
    const dismissed = await render({ checklist: { completed: {}, dismissedAt: '2026-10-01T00:00:00Z' } });
    expect(dismissed.el.querySelector('nv-onboarding-checklist')).toBeNull();
  });

  it('shows the checklist of a new space; dismissing asks first, then hides it for everyone', async () => {
    const { el, section, management, settle } = await render({ checklist: { completed: { logo: '2026-10-06T09:00:00Z' }, dismissedAt: null } });
    const checklist = section('onboarding-heading');
    expect(checklist.querySelector('h2')?.textContent).toBe('Get started');
    expect(checklist.textContent).toContain('1 of 4 done');
    expect([...checklist.querySelectorAll('h3')].map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Add your logo (done)',
      'Edit your home page (not done yet)',
      'Add a page (not done yet)',
      'Publish a page (not done yet)',
    ]);
    // The home page step goes straight to the top-level `home` page.
    expect([...checklist.querySelectorAll('a')].find((a) => a.textContent === 'Edit the home page')?.getAttribute('href')).toBe(
      `/spaces/${spaceId}/content/1`,
    );

    const confirm = TestBed.inject(Confirm);
    ([...checklist.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Dismiss checklist') as HTMLButtonElement).click();
    await settle();
    expect(confirm.request()?.heading).toBe('Dismiss the checklist?');
    confirm.request()?.answer(true);
    await settle();

    expect(management.dismissOnboarding).toHaveBeenCalledWith(spaceId);
    expect(el.querySelector('nv-onboarding-checklist')).toBeNull();
  });

  it('lets only people who can edit dismiss the checklist', async () => {
    const { section } = await render({ canEdit: false, checklist: { completed: {}, dismissedAt: null } });
    expect(section('onboarding-heading').textContent).not.toContain('Dismiss checklist');
  });
});
