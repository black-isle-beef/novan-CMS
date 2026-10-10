import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Confirm } from '@novan/admin-shell';
import { SpaceContext } from '@novan/admin-spaces';
import type { SpaceSummary, Webhook, WebhookDelivery, WebhookWithSecret } from '@novan/shared-schemas';
import { of } from 'rxjs';
import { SettingsApi } from '../settings-api';
import { WebhooksPage } from './webhooks-page';

const spaceId = '00000000-0000-4000-8000-000000000200';

const hook = (overrides: Partial<Webhook> = {}): Webhook => ({
  id: '00000000-0000-4000-8000-000000000601',
  name: 'Site build',
  url: 'https://build.example.com/hooks/novan',
  events: ['entry.published'],
  active: true,
  createdBy: null,
  createdByName: 'Novan Admin',
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-01T09:00:00Z',
  lastDelivery: { status: 'delivered', responseCode: 200, createdAt: '2026-10-02T10:00:00Z' },
  ...overrides,
});

const delivery = (overrides: Partial<WebhookDelivery> = {}): WebhookDelivery => ({
  id: '00000000-0000-4000-8000-000000000701',
  webhookId: hook().id,
  eventId: '00000000-0000-4000-8000-000000000801',
  event: 'entry.published',
  status: 'failed',
  responseCode: 503,
  attempt: 8,
  error: 'It answered 503.',
  createdAt: '2026-10-02T10:00:00Z',
  updatedAt: '2026-10-02T10:20:00Z',
  ...overrides,
});

describe('WebhooksPage', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let confirm: { ask: ReturnType<typeof vi.fn> };

  async function render() {
    const spaces = signal<SpaceSummary[] | null>([
      { id: spaceId, name: 'Demo site', slug: 'demo-site', organisationId: spaceId, previewUrl: null, requireApproval: false, role: 'developer', createdAt: '' },
    ]);
    const currentSpaceId = signal<string | null>(null);
    TestBed.configureTestingModule({
      imports: [WebhooksPage],
      providers: [
        { provide: SettingsApi, useValue: api },
        { provide: Confirm, useValue: confirm },
        { provide: SpaceContext, useValue: { spaces, currentSpaceId, currentSpace: computed(() => spaces()?.find((s) => s.id === currentSpaceId()) ?? null) } },
      ],
    });
    const fixture = TestBed.createComponent(WebhooksPage);
    fixture.componentRef.setInput('spaceId', spaceId);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const click = async (name: string) => {
      ([...el.querySelectorAll('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim().startsWith(name)) as HTMLButtonElement).click();
      await settle();
    };
    const type = async (id: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    return { fixture, el, click, type, settle };
  }

  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    confirm = { ask: vi.fn(() => Promise.resolve(true)) };
    api = {
      listWebhooks: vi.fn(() => of([hook(), hook({ id: '00000000-0000-4000-8000-000000000602', name: 'Search', active: false, lastDelivery: null, events: ['asset.deleted', 'entry.unpublished'] })])),
      createWebhook: vi.fn((_s: string, body: { name: string; url: string; events: string[] }) =>
        of({ ...hook({ id: '00000000-0000-4000-8000-000000000603', ...body, lastDelivery: null } as Partial<Webhook>), secret: 'whsec_shown-once' } satisfies WebhookWithSecret),
      ),
      updateWebhook: vi.fn((_s: string, id: string, body: Partial<Webhook>) => of(hook({ id, ...body }))),
      rotateWebhookSecret: vi.fn(() => of({ ...hook(), secret: 'whsec_new-secret' })),
      deleteWebhook: vi.fn(() => of(undefined)),
      webhookDeliveries: vi.fn(() => of([delivery(), delivery({ id: '00000000-0000-4000-8000-000000000702', status: 'delivered', responseCode: 200, attempt: 1, error: null })])),
      resendWebhookDelivery: vi.fn(() => of(delivery({ status: 'pending', attempt: 0, responseCode: null, error: null }))),
      testWebhook: vi.fn(() => of(delivery({ event: 'ping', status: 'pending', attempt: 0 }))),
    };
  });

  it('lists the webhooks, what they send and how the last delivery went', async () => {
    const { el } = await render();
    const rows = [...el.querySelectorAll('tbody tr')].map((row) => text(row));
    expect(rows[0]).toContain('Site build');
    expect(rows[0]).toContain('A page or entry is published');
    expect(rows[0]).toContain('Delivered (200)');
    expect(rows[1]).toContain('Off');
    expect(rows[1]).toContain('Never');
    expect(el.querySelector('h1')?.textContent).toBe('Webhooks');
  });

  it('checks the form, then adds the webhook and shows its secret once, with focus on it', async () => {
    const { el, click, type } = await render();
    // Untick the default events.
    for (const id of ['webhook-event-entry.published', 'webhook-event-entry.unpublished']) {
      const box = el.querySelector<HTMLInputElement>(`[id="${id}"]`) as HTMLInputElement;
      box.checked = false;
      box.dispatchEvent(new Event('change'));
    }
    await click('Add webhook');
    expect(api['createWebhook']).not.toHaveBeenCalled();
    expect(text(el.querySelector('#webhook-name-error'))).toBe('Enter a name for the webhook.');
    expect(el.querySelector('#webhook-url')?.getAttribute('aria-invalid')).toBe('true');
    expect(text(el.querySelector('#webhook-events-error'))).toBe('Choose at least one event.');

    await type('webhook-name', 'Search index');
    await type('webhook-url', 'https://search.example.com/novan');
    const box = el.querySelector<HTMLInputElement>('[id="webhook-event-asset.deleted"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await click('Add webhook');
    expect(api['createWebhook']).toHaveBeenCalledWith(spaceId, { name: 'Search index', url: 'https://search.example.com/novan', events: ['asset.deleted'] });
    expect(el.querySelector<HTMLInputElement>('#webhook-secret')?.value).toBe('whsec_shown-once');
    expect(document.activeElement?.id).toBe('secret-heading');
  });

  it('opens the delivery log, says why one failed, and resends it', async () => {
    const { el, click } = await render();
    await click('Delivery log of Site build');
    expect(api['webhookDeliveries']).toHaveBeenCalledWith(spaceId, hook().id);
    const log = el.querySelector('#webhook-log') as HTMLElement;
    expect(text(log)).toContain('Failed (503)');
    expect(text(log)).toContain('It answered 503.');
    expect(text(log)).toContain('Delivered (200)');
    expect(document.activeElement?.id).toBe('log-heading');

    ([...log.querySelectorAll('button')].find((b) => text(b)?.startsWith('Resend')) as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(api['resendWebhookDelivery']).toHaveBeenCalledWith(spaceId, hook().id, delivery().id);
  });

  it('asks before replacing a secret or deleting, and does nothing when cancelled', async () => {
    const { el, click } = await render();
    confirm.ask.mockResolvedValueOnce(false);
    await click('Delete Site build');
    expect(api['deleteWebhook']).not.toHaveBeenCalled();

    await click('Replace secret of Site build');
    expect(confirm.ask).toHaveBeenLastCalledWith(expect.objectContaining({ heading: 'Replace the secret of Site build?' }));
    expect(el.querySelector<HTMLInputElement>('#webhook-secret')?.value).toBe('whsec_new-secret');

    await click('Delete Site build');
    expect(api['deleteWebhook']).toHaveBeenCalledWith(spaceId, hook().id);
    expect([...el.querySelectorAll('tbody tr')].map((row) => text(row))).not.toContainEqual(expect.stringContaining('Site build'));
  });

  it('turns a webhook off and on, and sends a test', async () => {
    const { el, click } = await render();
    await click('Turn off Site build');
    expect(api['updateWebhook']).toHaveBeenCalledWith(spaceId, hook().id, { active: false });
    expect(text(el.querySelector('[role="status"]'))).toContain('Site build is off.');
    await click('Turn on Site build');
    await click('Send a test to Site build');
    expect(api['testWebhook']).toHaveBeenCalledWith(spaceId, hook().id);
  });
});
