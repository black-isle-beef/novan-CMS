import { TestBed } from '@angular/core/testing';
import { DesignSystemsApi } from '@novan/admin-spaces';
import type { SiteDesignSystem } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { EditorClassIndex } from './class-index';

const item = (n: number, overrides: Partial<SiteDesignSystem> = {}): SiteDesignSystem => ({
  designSystemId: `ds-${n}`,
  versionId: `v-${n}`,
  name: n === 1 ? 'Bootstrap' : 'Acme',
  slug: `ds-${n}`,
  framework: n === 1 ? 'bootstrap' : 'css',
  version: `${n}.0.0`,
  status: 'ready',
  loadOrder: n - 1,
  enabled: true,
  breakpoints: null,
  states: null,
  ...overrides,
});

describe('EditorClassIndex', () => {
  const api = { site: vi.fn(), classes: vi.fn() };

  function setup(site: SiteDesignSystem[]) {
    api.site.mockReturnValue(of(site));
    api.classes.mockImplementation((_space: string, designSystemId: string, _version: string, query: { q: string }) =>
      of({
        items: (designSystemId === 'ds-1' ? ['btn', 'btn-primary', 'card'] : ['btn', 'acme-btn-x'])
          .filter((name) => name.startsWith(query.q))
          .map((name) => ({ name, group: null })),
        groups: [],
        total: 0,
      }),
    );
    TestBed.configureTestingModule({ providers: [EditorClassIndex, { provide: DesignSystemsApi, useValue: api }] });
    return TestBed.inject(EditorClassIndex);
  }

  beforeEach(() => vi.clearAllMocks());

  it('uses the first enabled design system for the adapter, and names them all', async () => {
    const index = setup([item(1, { enabled: false }), item(2, { breakpoints: { md: '{class}@md' } })]);
    await index.load('space', true);
    expect(index.adapter().framework).toBe('css');
    expect(index.adapter().breakpoints).toEqual(['md']);
    expect(index.label()).toBe('Acme 2.0.0');
  });

  it('merges suggestions from every design system, shortest first, once each, and asks once per word', async () => {
    const index = setup([item(1), item(2)]);
    await index.load('space', true);
    expect((await index.suggest('b')).map((entry) => `${entry.name}:${entry.source}`)).toEqual(['btn:Bootstrap', 'btn-primary:Bootstrap']);
    await index.suggest('b');
    expect(api.classes).toHaveBeenCalledTimes(2);
    expect(await index.exists('card')).toBe(true);
    expect(await index.exists('cards')).toBe(false);
  });

  it('has nothing to say without design systems, or when the API cannot answer', async () => {
    const index = setup([item(1)]);
    await index.load('space', false);
    expect(api.site).not.toHaveBeenCalled();
    expect(await index.exists('btn')).toBeNull();
    expect(index.adapter().framework).toBe('css');
    api.site.mockReturnValue(throwError(() => new Error('offline')));
    await index.load('space', true);
    expect(index.label()).toBeNull();
  });
});
