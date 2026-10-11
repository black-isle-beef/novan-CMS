import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import { SpaceContext } from '@novan/admin-spaces';
import type { AdminSearchResults } from '@novan/shared-schemas';
import axe from 'axe-core';
import { SearchPalette } from './search-palette';

const spaceId = '00000000-0000-4000-8000-000000000200';
const results: AdminSearchResults = {
  pages: [
    { kind: 'page', id: '00000000-0000-4000-8000-000000000701', title: 'Home', detail: '/', status: 'published' },
    { kind: 'page', id: '00000000-0000-4000-8000-000000000702', title: 'About', detail: '/about', status: 'draft' },
  ],
  entries: [{ kind: 'entry', id: '00000000-0000-4000-8000-000000000711', title: 'Navigation', detail: 'Navigation', status: 'published' }],
  media: [{ kind: 'media', id: '00000000-0000-4000-8000-000000000501', title: 'Navy shapes', detail: 'shapes-navy.jpg', status: null }],
};

// jsdom has no modal dialogs; the design system's modal opens one.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
  Element.prototype.scrollIntoView ??= () => undefined;
});

describe('SearchPalette', () => {
  function setup(agencyMode = false) {
    vi.useFakeTimers();
    const navigate = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [SearchPalette],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ADMIN_CONFIG, useValue: { apiUrl: 'http://api.test' } },
        { provide: Router, useValue: { navigate } },
        {
          provide: SpaceContext,
          useValue: { currentSpace: computed(() => ({ id: spaceId, name: 'Demo site' })), agencyMode: signal(agencyMode) },
        },
      ],
    });
    const fixture = TestBed.createComponent(SearchPalette);
    fixture.componentRef.setInput('spaceId', spaceId);
    fixture.detectChanges();
    fixture.componentInstance.show();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const box = () => el.querySelector<HTMLInputElement>('#nv-search-box') as HTMLInputElement;
    const type = async (text: string) => {
      box().value = text;
      box().dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(250);
      fixture.detectChanges();
    };
    const press = (key: string) => {
      box().dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      fixture.detectChanges();
    };
    return { fixture, el, box, type, press, navigate, http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => vi.useRealTimers());

  it('opens with the box focused, and searches the space as people type', async () => {
    const { fixture, el, box, type, http } = setup();
    await fixture.whenStable();
    expect(document.activeElement).toBe(box());
    expect(el.textContent).toContain('Search Demo site');

    await type('ho');
    const req = http.expectOne((r) => r.url === `http://api.test/v1/management/spaces/${spaceId}/search`);
    expect(req.request.params.get('q')).toBe('ho');
    req.flush(results);
    fixture.detectChanges();

    expect([...el.querySelectorAll('[role="group"]')].map((group) => group.querySelector('[id]')?.textContent?.trim())).toEqual([
      'Pages',
      'Other content',
      'Media',
    ]);
    expect([...el.querySelectorAll('[role="option"]')].map((option) => [...option.children].map((part) => part.textContent?.trim()))).toEqual([
      ['Home', '/ · Published'],
      ['About', '/about · Draft'],
      ['Navigation', 'Navigation · Published'],
      ['Navy shapes', 'shapes-navy.jpg'],
    ]);
    expect(el.querySelector('[role="status"]')?.textContent).toContain('4 results.');
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(`nv-search-page-${results.pages[0].id}`);
  });

  it('moves through results with the arrow keys and opens one with Enter', async () => {
    const { fixture, box, type, press, navigate, http } = setup();
    await type('na');
    http.expectOne(() => true).flush(results);
    fixture.detectChanges();

    press('ArrowUp');
    expect(box().getAttribute('aria-activedescendant')).toBe(`nv-search-media-${results.media[0].id}`);
    press('Enter');
    expect(navigate).toHaveBeenCalledWith(['/spaces', spaceId, 'media'], { queryParams: { asset: results.media[0].id } });
    expect(fixture.componentInstance.open()).toBe(false);

    fixture.componentInstance.show();
    fixture.detectChanges();
    press('ArrowDown');
    press('ArrowDown');
    expect(box().getAttribute('aria-activedescendant')).toBe(`nv-search-entry-${results.entries[0].id}`);
    press('Enter');
    expect(navigate).toHaveBeenLastCalledWith(['/spaces', spaceId, 'content', results.entries[0].id]);
  });

  it('waits for two letters, and names entries as such for agency roles', async () => {
    const { fixture, el, type, http } = setup(true);
    await type('h');
    http.expectNone(() => true);
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Type at least 2 letters.');

    await type('home');
    http.expectOne(() => true).flush({ pages: [], entries: results.entries, media: [] });
    fixture.detectChanges();
    expect(el.querySelector('[role="group"] [id]')?.textContent?.trim()).toBe('Entries');
  });

  it('says when nothing matched', async () => {
    const { fixture, el, box, type, http } = setup();
    await type('zebra');
    http.expectOne(() => true).flush({ pages: [], entries: [], media: [] });
    fixture.detectChanges();
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Nothing found for “zebra”.');
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('has no axe violations with results showing', async () => {
    const { fixture, el, type, http } = setup();
    await type('ho');
    http.expectOne(() => true).flush(results);
    fixture.detectChanges();
    vi.useRealTimers();
    const outcome = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
    expect(outcome.violations.map((violation) => `${violation.id}: ${violation.nodes.map((n) => n.html).join(', ')}`)).toEqual([]);
  });
});
