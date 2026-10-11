import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Confirm } from '@novan/admin-shell';
import { hasPermission, type Permission, SpaceContext } from '@novan/admin-spaces';
import type { FormSettings, FormSubmission, FormSummary, SpaceRole, SpaceSummary } from '@novan/shared-schemas';
import axe from 'axe-core';
import { of } from 'rxjs';
import { FormsApi } from '../forms-api';
import { FormsPage } from './forms-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const contact = '00000000-0000-4000-8000-000000000924';

const message = (overrides: Partial<FormSubmission> = {}): FormSubmission => ({
  id: '00000000-0000-4000-8000-000000000a01',
  entryId: '00000000-0000-4000-8000-000000000703',
  formUid: contact,
  formName: 'Send us a message',
  pagePath: '/contact',
  locale: 'en-GB',
  data: { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Hello,\nthere', consent: true },
  fields: [
    { name: 'name', label: 'Your name', type: 'text' },
    { name: 'email', label: 'Email address', type: 'email' },
    { name: 'message', label: 'Message', type: 'textarea' },
    { name: 'consent', label: 'I agree', type: 'consent' },
  ],
  createdAt: '2026-10-11T09:30:00Z',
  ...overrides,
});
const older = message({ id: '00000000-0000-4000-8000-000000000a02', data: { name: 'Grace Hopper' }, createdAt: '2026-10-10T09:30:00Z' });
const summary: FormSummary = { formUid: contact, formName: 'Send us a message', pagePath: '/contact', entryId: message().entryId, count: 2, lastAt: message().createdAt };
const settings: FormSettings = { recipients: ['forms@example.com'], retentionMonths: 12 };

describe('FormsPage', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let confirm: { ask: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = {
      forms: vi.fn(() => of([summary])),
      settings: vi.fn(() => of(settings)),
      submissions: vi.fn(() => of({ items: [message(), older], nextCursor: null })),
      submission: vi.fn(() => of(message())),
      deleteSubmission: vi.fn(() => of(undefined)),
      export: vi.fn(() => of({ blob: new Blob(['"a"']), filename: 'send-us-a-message-submissions.csv' })),
      updateSettings: vi.fn((_: string, body: FormSettings) => of(body)),
    };
    confirm = { ask: vi.fn(() => Promise.resolve(true)) };
  });

  async function render(role: SpaceRole, submission?: string) {
    const spaces = signal<SpaceSummary[] | null>([
      { id: spaceId, name: 'Demo site', slug: 'demo-site', organisationId: spaceId, previewUrl: null, requireApproval: false, role, createdAt: '' },
    ]);
    const currentSpaceId = signal<string | null>(null);
    TestBed.configureTestingModule({
      imports: [FormsPage],
      providers: [
        { provide: FormsApi, useValue: api },
        { provide: Confirm, useValue: confirm },
        {
          provide: SpaceContext,
          useValue: {
            spaces,
            currentSpaceId,
            currentSpace: computed(() => spaces()?.find((s) => s.id === currentSpaceId()) ?? null),
            viewingAs: signal(null),
            can: (permission: Permission) => hasPermission(permission, { role, agencyStaff: false }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(FormsPage);
    fixture.componentRef.setInput('spaceId', spaceId);
    if (submission) fixture.componentRef.setInput('submission', submission);
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
    return { fixture, el, settle, click };
  }

  it('lists messages newest first, with the form, page and first answer', async () => {
    const { el } = await render('editor');
    const cells = (row: Element) => [...row.querySelectorAll('th, td')].slice(1, 3).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim());
    const [first, second] = [...el.querySelectorAll('tbody tr')];
    expect(cells(first)).toEqual(['Send us a message /contact', 'Ada Lovelace']);
    expect(cells(second)).toEqual(['Send us a message /contact', 'Grace Hopper']);
    expect([...el.querySelectorAll('#forms-filter option')].map((o) => o.textContent?.trim())).toEqual([
      'All forms (2)',
      'Send us a message on /contact (2)',
    ]);
    expect(el.textContent).not.toMatch(/\bentr(y|ies)\b/i);
  });

  it('opens a message, moving focus to it, with every answer', async () => {
    const { el, click } = await render('editor');
    await click('Read');
    const heading = el.querySelector('#forms-detail-heading');
    expect(document.activeElement).toBe(heading);
    const answers = [...el.querySelectorAll('#forms-detail dt, #forms-detail dd')].map((node) => node.textContent?.trim());
    expect(answers).toEqual(['Your name', 'Ada Lovelace', 'Email address', 'ada@example.com', 'Message', 'Hello,\nthere', 'I agree', 'Yes']);
  });

  it('opens the message an email links to', async () => {
    const { el } = await render('editor', message().id);
    expect(api['submission']).toHaveBeenCalledWith(spaceId, message().id);
    expect(el.querySelector('#forms-detail-heading')).not.toBeNull();
  });

  it('filters by form and downloads its messages', async () => {
    const { el, settle, click } = await render('editor');
    const select = el.querySelector<HTMLSelectElement>('#forms-filter') as HTMLSelectElement;
    select.value = contact;
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(api['submissions']).toHaveBeenLastCalledWith(spaceId, { form: contact, limit: 50 });

    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    await click('Download as a spreadsheet');
    expect(api['export']).toHaveBeenCalledWith(spaceId, contact);
    expect(created).toHaveBeenCalled();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('downloading');
  });

  it('deletes a message after asking', async () => {
    const { el, click } = await render('editor');
    await click('Delete');
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({ heading: 'Delete this message?', destructive: true }));
    expect(api['deleteSubmission']).toHaveBeenCalledWith(spaceId, message().id);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.querySelector('[role="status"]')?.textContent).toContain('The message is deleted.');
  });

  it('shows editors the settings, and lets admins change them', async () => {
    const editor = await render('editor');
    expect(editor.el.querySelector('#forms-recipients')).toBeNull();
    expect(editor.el.textContent).toContain('Emails about new messages go to forms@example.com.');
    TestBed.resetTestingModule();

    const { el, settle, click } = await render('admin');
    const recipients = el.querySelector<HTMLTextAreaElement>('#forms-recipients') as HTMLTextAreaElement;
    expect(recipients.value).toBe('forms@example.com');
    recipients.value = 'not an address';
    recipients.dispatchEvent(new Event('input'));
    await click('Save form settings');
    expect(api['updateSettings']).not.toHaveBeenCalled();
    expect(recipients.getAttribute('aria-describedby')).toContain('forms-recipients-error');

    recipients.value = 'office@example.com\nsales@example.com';
    recipients.dispatchEvent(new Event('input'));
    const months = el.querySelector<HTMLInputElement>('#forms-retention') as HTMLInputElement;
    months.value = '6';
    months.dispatchEvent(new Event('input'));
    await settle();
    await click('Save form settings');
    expect(api['updateSettings']).toHaveBeenCalledWith(spaceId, { recipients: ['office@example.com', 'sales@example.com'], retentionMonths: 6 });
  });

  it('says so when there are no messages yet', async () => {
    api['forms'] = vi.fn(() => of([]));
    const { el } = await render('editor');
    expect(el.textContent).toContain('No messages yet.');
    expect(el.querySelector('table')).toBeNull();
  });

  it('has no axe violations, with a message open', async () => {
    const { el, click } = await render('admin');
    await click('Read');
    const results = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
