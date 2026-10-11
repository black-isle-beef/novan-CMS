import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SpaceContext } from '@novan/admin-spaces';
import type { AuditContentDiff, AuditEvent, SpaceSummary } from '@novan/shared-schemas';
import axe from 'axe-core';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { SettingsApi } from '../settings-api';
import { AuditLogPage } from './audit-log-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const pageId = '00000000-0000-4000-8000-000000000701';
const adminId = '00000000-0000-4000-8000-000000000003';

const event = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  id: '00000000-0000-4000-8000-000000000b01',
  action: 'entry.published',
  actorId: adminId,
  actorName: 'Novan Admin',
  targetType: 'entry',
  targetId: pageId,
  diff: { versionId: 'v2', previousVersionId: 'v1', path: '/home' },
  // 13:30 in London (British Summer Time).
  createdAt: '2026-10-11T12:30:00Z',
  hasContentDiff: true,
  ...overrides,
});
const purge = event({ id: '00000000-0000-4000-8000-000000000b02', action: 'entry.purged', actorId: null, actorName: null, diff: { slug: 'old' }, hasContentDiff: false });
const diff: AuditContentDiff = {
  entryId: pageId,
  fromVersionId: 'v1',
  toVersionId: 'v2',
  changes: [{ kind: 'changed', path: ['title'], before: 'Home', after: 'Welcome' }],
};

describe('AuditLogPage', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    api = {
      auditActors: vi.fn(() => of([{ id: adminId, name: 'Novan Admin' }])),
      auditEvents: vi.fn(() => of({ items: [event(), purge], nextCursor: 'more' })),
      auditContentDiff: vi.fn(() => of(diff)),
      exportAudit: vi.fn(() => of({ blob: new Blob(['x']), filename: 'audit-log.csv' })),
    };
  });

  async function render() {
    const spaces = signal<SpaceSummary[] | null>([
      { id: spaceId, name: 'Demo site', slug: 'demo-site', organisationId: spaceId, previewUrl: null, requireApproval: false, role: 'admin', createdAt: '' },
    ]);
    const currentSpaceId = signal<string | null>(null);
    TestBed.configureTestingModule({
      imports: [AuditLogPage],
      providers: [
        provideRouter([]),
        { provide: SettingsApi, useValue: api },
        { provide: SpaceContext, useValue: { spaces, currentSpaceId, currentSpace: computed(() => spaces()?.find((s) => s.id === currentSpaceId()) ?? null) } },
      ],
    });
    const fixture = TestBed.createComponent(AuditLogPage);
    fixture.componentRef.setInput('spaceId', spaceId);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    const click = async (name: string) => {
      ([...el.querySelectorAll('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim().startsWith(name)) as HTMLButtonElement).click();
      await settle();
    };
    const choose = async (id: string, value: string) => {
      const control = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`) as HTMLInputElement;
      control.value = value;
      control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input'));
      await settle();
    };
    return { el, click, choose, settle };
  }

  it('lists changes in UK time, in plain words, linking to what they were about', async () => {
    const { el } = await render();
    const [first, second] = [...el.querySelectorAll('tbody tr')];
    const cells = (row: Element) => [...row.querySelectorAll('td, th')].slice(0, 4).map((cell) => cell.textContent?.trim());
    expect(cells(first)).toEqual(['11 Oct 2026, 13:30', 'Novan Admin', 'Published a page', '/home']);
    expect(first.querySelector('a')?.getAttribute('href')).toBe(`/spaces/${spaceId}/content/${pageId}`);
    expect(cells(second)).toEqual(['11 Oct 2026, 13:30', 'Novan CMS', 'Deleted a page for good', 'old']);
    // A page deleted for good has nowhere to go.
    expect(second.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('2 or more changes, newest first.');
  });

  it('filters by person, kind of change and UK days', async () => {
    const { el, choose, click } = await render();
    expect([...el.querySelectorAll('#audit-action optgroup')].map((group) => group.getAttribute('label'))).toContain('Pages');
    await choose('audit-actor', adminId);
    await choose('audit-action', 'entry');
    await choose('audit-from', '2026-10-01');
    await choose('audit-to', '2026-10-11');
    await click('Filter');
    expect(api['auditEvents']).toHaveBeenLastCalledWith(spaceId, { actor: adminId, action: 'entry', from: '2026-10-01', to: '2026-10-11', limit: 50 });
    expect(el.querySelector('[role="status"]')?.textContent).toContain('only the changes you chose');

    await choose('audit-from', '2026-10-12');
    await click('Filter');
    expect(el.querySelector('#audit-to')?.getAttribute('aria-describedby')).toBe('audit-to-error');
    expect(api['auditEvents']).toHaveBeenCalledTimes(2);

    await click('Clear');
    expect(api['auditEvents']).toHaveBeenLastCalledWith(spaceId, { actor: undefined, action: undefined, from: undefined, to: undefined, limit: 50 });
  });

  it('opens an event\'s details, and what a publish changed on the page', async () => {
    const { el, click } = await render();
    await click('Details');
    expect(document.activeElement?.textContent?.trim()).toBe('Published a page: what was recorded');
    expect([...el.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['versionId', 'previousVersionId', 'path']);
    await click('Show what changed on the page');
    expect(api['auditContentDiff']).toHaveBeenCalledWith(spaceId, event().id);
    const change = el.querySelector('tbody li') as HTMLElement;
    expect(change.textContent).toMatch(/^\s*Changed title/);
    expect([...change.querySelectorAll(':scope > .d-block')].map((line) => line.textContent?.trim())).toEqual(['Before: Home', 'After: Welcome']);
  });

  it('explains when the versions are no longer kept', async () => {
    api['auditContentDiff'] = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 404, error: { code: 'version_not_found', detail: 'The versions this event changed are no longer kept.' } })),
    );
    const { el, click } = await render();
    await click('Details');
    await click('Show what changed on the page');
    expect(el.textContent).toContain('no longer kept');
  });

  it('loads older changes and downloads the filtered log', async () => {
    const { el, click } = await render();
    api['auditEvents'] = vi.fn(() => of({ items: [event({ id: '00000000-0000-4000-8000-000000000b03' })], nextCursor: null }));
    await click('Show older changes');
    expect(api['auditEvents']).toHaveBeenCalledWith(spaceId, expect.objectContaining({ cursor: 'more' }));
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    await click('Download as a spreadsheet');
    expect(api['exportAudit']).toHaveBeenCalledWith(spaceId, { actor: undefined, action: undefined, from: undefined, to: undefined });
  });

  it('has no axe violations with an event open', async () => {
    const { el, click } = await render();
    await click('Details');
    await click('Show what changed on the page');
    const results = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
