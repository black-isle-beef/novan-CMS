import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DesignSystemsApi, SpaceContext } from '@novan/admin-spaces';
import type { DesignSystem, DesignSystemVersion, SiteDesignSystem, SpaceSummary } from '@novan/shared-schemas';
import axe from 'axe-core';
import { of } from 'rxjs';
import { DesignSystemsPage, safeFilename } from './design-systems-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const version = (n: number, overrides: Partial<DesignSystemVersion> = {}): DesignSystemVersion => ({
  id: uid(n),
  designSystemId: uid(1),
  version: `1.${n}.0`,
  status: 'ready',
  source: 'css',
  sourceUrl: null,
  filename: 'acme.css',
  report: { errors: [], warnings: [], classes: 3 },
  createdAt: '2026-10-20T09:00:00Z',
  processedAt: '2026-10-20T09:00:05Z',
  ...overrides,
});

const acme: DesignSystem = {
  id: uid(1),
  name: 'Acme',
  slug: 'acme',
  framework: 'bootstrap',
  createdAt: '2026-10-20T09:00:00Z',
  versions: [
    version(12),
    version(11, { status: 'invalid', report: { errors: [{ message: 'The stylesheet cannot be read: Unclosed block.', file: 'acme.css', line: 2 }], warnings: [] } }),
  ],
};
const tokens: DesignSystem = { id: uid(2), name: 'Tokens', slug: 'tokens', framework: 'css', createdAt: '2026-10-21T09:00:00Z', versions: [version(21, { designSystemId: uid(2), version: '2.0.0' })] };

const attached = (v: DesignSystemVersion, system: DesignSystem, loadOrder: number): SiteDesignSystem => ({
  designSystemId: system.id,
  versionId: v.id,
  name: system.name,
  slug: system.slug,
  framework: system.framework,
  version: v.version,
  status: v.status,
  loadOrder,
  enabled: true,
  breakpoints: null,
  states: null,
});

describe('DesignSystemsPage', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  async function render(enabled = true) {
    const spaces = signal<SpaceSummary[] | null>([
      { id: spaceId, name: 'Demo site', slug: 'demo-site', organisationId: spaceId, previewUrl: null, requireApproval: false, allowSvg: false, designSystems: enabled, role: 'developer', createdAt: '' },
    ]);
    const currentSpaceId = signal<string | null>(null);
    TestBed.configureTestingModule({
      imports: [DesignSystemsPage],
      providers: [
        { provide: DesignSystemsApi, useValue: api },
        { provide: SpaceContext, useValue: { spaces, currentSpaceId, currentSpace: computed(() => spaces()?.find((s) => s.id === currentSpaceId()) ?? null) } },
      ],
    });
    const fixture = TestBed.createComponent(DesignSystemsPage);
    fixture.componentRef.setInput('spaceId', spaceId);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const button = (name: string) =>
      [...el.querySelectorAll('button')].find((candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === name) as HTMLButtonElement;
    const status = () => el.querySelector('[role="status"]')?.textContent?.trim();
    return { fixture, el, settle, button, status };
  }

  beforeEach(() => {
    api = {
      list: vi.fn().mockReturnValue(of([acme, tokens])),
      site: vi.fn().mockReturnValue(of([attached(acme.versions[0], acme, 0)])),
      putSite: vi.fn(),
      create: vi.fn(),
      createVersion: vi.fn(),
      upload: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn(),
      version: vi.fn(),
      deprecate: vi.fn(),
      classes: vi.fn().mockReturnValue(of({ items: [{ name: 'btn', group: 'buttons' }], groups: [{ group: 'buttons', count: 1 }], total: 1 })),
    };
  });

  it('asks for the agency until design systems are on', async () => {
    const { el } = await render(false);
    expect(el.textContent).toContain('Design systems are not turned on for this space.');
    expect(api['list']).not.toHaveBeenCalled();
  });

  it('lists what the site loads, and each version with its status and what checking found', async () => {
    const { el } = await render();
    expect(el.querySelector('ol')?.textContent).toContain('Acme 1.12.0');
    expect([...el.querySelectorAll('tbody th[scope=row]')].map((th) => th.textContent?.trim())).toEqual(['1.12.0', '1.11.0', '2.0.0']);
    expect(el.textContent).toContain('Has problems');
    const details = el.querySelector('details');
    expect(details?.open).toBe(true);
    expect(details?.textContent).toContain('The stylesheet cannot be read: Unclosed block. (line 2)');
  });

  it('adds a ready version, moves it, and saves the order', async () => {
    const { el, settle, button, status } = await render();
    api['putSite'].mockReturnValue(of([attached(tokens.versions[0], tokens, 0), attached(acme.versions[0], acme, 1)]));
    const select = el.querySelector<HTMLSelectElement>('#ds-attach') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent?.trim())).toEqual(['Choose a ready version', 'Tokens 2.0.0']);
    select.value = uid(21);
    select.dispatchEvent(new Event('change'));
    await settle();
    button('Add').click();
    await settle();
    button('Move Tokens up').click();
    await settle();
    expect(status()).toBe('Tokens moved to position 1 of 2.');
    expect(button('Move Tokens up').disabled).toBe(true);
    button('Save what the site loads').click();
    await settle();
    expect(api['putSite']).toHaveBeenCalledWith(spaceId, [
      { versionId: uid(21), enabled: true },
      { versionId: uid(12), enabled: true },
    ]);
    expect(status()).toBe('Saved. The site loads these design systems from its next page view.');
    expect(button('Save what the site loads').disabled).toBe(true);
  });

  it('uploads a stylesheet as a new version, then says when it is checked', async () => {
    const started = version(13, { status: 'uploaded' });
    api['createVersion'].mockReturnValue(of({ version: started, uploadUrl: 'https://storage.example/upload' }));
    api['complete'].mockReturnValue(of({ ...started, status: 'validating' }));
    api['version'].mockReturnValueOnce(of({ ...started, status: 'validating' }));
    api['version'].mockReturnValue(of({ ...started, status: 'ready', report: { errors: [], warnings: [{ message: 'x' }], classes: 1 } }));
    const { fixture, el, settle, button, status } = await render();
    fixture.componentInstance['pollMs'] = 5;
    fixture.componentInstance['versionForm'].patchValue({ version: '1.13.0' });
    const input = el.querySelector<HTMLInputElement>('#ds-version-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['.a{}'], 'My Styles!.css', { type: 'text/css' })] });
    input.dispatchEvent(new Event('change'));
    button('Add version').click();
    await settle();
    expect(api['createVersion']).toHaveBeenCalledWith(spaceId, uid(1), { source: 'css', version: '1.13.0', filename: 'My-Styles-.css' });
    expect(api['upload']).toHaveBeenCalledWith('https://storage.example/upload', expect.any(File));
    await vi.waitFor(() => expect(api['version']).toHaveBeenCalledTimes(2));
    await settle();
    expect(status()).toBe('Version 1.13.0 is ready, with 1 thing to look at.');
    expect(el.querySelector('tbody th[scope=row]')?.textContent?.trim()).toBe('1.13.0');
  });

  it('takes an https address instead of a file', async () => {
    api['createVersion'].mockReturnValue(of({ version: version(14, { status: 'validating', source: 'url', sourceUrl: 'https://cdn.example/b.css' }), uploadUrl: null }));
    api['version'].mockReturnValue(of(version(14)));
    const { el, settle, button } = await render();
    (el.querySelector('#ds-version-source-url') as HTMLInputElement).click();
    await settle();
    const url = el.querySelector<HTMLInputElement>('#ds-version-url') as HTMLInputElement;
    url.value = 'http://cdn.example/b.css';
    url.dispatchEvent(new Event('input'));
    button('Add version').click();
    await settle();
    expect(api['createVersion']).not.toHaveBeenCalled();
    expect(url.getAttribute('aria-invalid')).toBe('true');
    url.value = 'https://cdn.example/b.css';
    url.dispatchEvent(new Event('input'));
    button('Add version').click();
    await settle();
    expect(api['createVersion']).toHaveBeenCalledWith(spaceId, uid(1), { source: 'url', version: '1.0.0', url: 'https://cdn.example/b.css' });
    expect(api['upload']).not.toHaveBeenCalled();
  });

  it('shows the classes of a version, searched as people type', async () => {
    const { el, settle, button } = await render();
    button('Classes in Acme 1.12.0').click();
    await settle();
    expect(el.querySelector('#ds-classes-heading')?.textContent).toContain('Classes in Acme 1.12.0');
    const q = el.querySelector<HTMLInputElement>('#ds-classes-q') as HTMLInputElement;
    q.value = 'bt';
    q.dispatchEvent(new Event('input'));
    await settle();
    expect(api['classes']).toHaveBeenLastCalledWith(spaceId, uid(1), uid(12), { q: 'bt', group: undefined, limit: 100 });
    expect(el.querySelector('[aria-label="Classes found"]')?.textContent).toContain('btn');
  });

  it('makes file names safe for the API', () => {
    expect(safeFilename('bootstrap.min.css')).toBe('bootstrap.min.css');
    expect(safeFilename('My Styles!.css')).toBe('My-Styles-.css');
    expect(safeFilename('../../x')).toBe('x.css');
  });

  it.each([
    ['turned off', false, false],
    ['with design systems', true, false],
    ['browsing classes', true, true],
  ])('has no axe violations %s', async (_, enabled, browse) => {
    const { el, settle, button } = await render(enabled);
    if (browse) {
      button('Classes in Acme 1.12.0').click();
      await settle();
    }
    const results = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
