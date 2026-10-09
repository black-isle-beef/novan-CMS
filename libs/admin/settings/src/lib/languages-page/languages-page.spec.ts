import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from '@black-isle-beef/novan-design-system';
import { Confirm } from '@novan/admin-shell';
import { ManagementApi, SpaceContext, SpaceLocales } from '@novan/admin-spaces';
import type { CreateLocaleRequest, ManagedLocales, SpaceLocale } from '@novan/shared-schemas';
import { of } from 'rxjs';
import { LanguagesPage } from './languages-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const english: SpaceLocale = { code: 'en-GB', name: 'English (UK)', fallback: null, isDefault: true, prefix: 'en' };
const welsh: SpaceLocale = { code: 'cy-GB', name: 'Welsh', fallback: 'en-GB', isDefault: false, prefix: 'cy' };

async function render(options: { role?: 'admin' | 'developer' | 'editor'; prefixes?: boolean } = {}) {
  const role = options.role ?? 'admin';
  let state: ManagedLocales = { locales: [english, welsh], prefixes: options.prefixes ?? false, machineTranslation: false };
  const answer = (next: ManagedLocales) => {
    state = next;
    return of(next);
  };
  const api = {
    listLocales: vi.fn(() => of(state)),
    createLocale: vi.fn((_s: string, body: CreateLocaleRequest) =>
      answer({ ...state, locales: [...state.locales, { code: body.code, name: body.name, fallback: body.fallback ?? null, isDefault: false, prefix: body.prefix ?? 'x' }] }),
    ),
    updateLocale: vi.fn((_s: string, code: string, body: Partial<SpaceLocale>) =>
      answer({ ...state, locales: state.locales.map((l) => (l.code === code ? { ...l, ...body } : body.isDefault ? { ...l, isDefault: false } : l)) }),
    ),
    removeLocale: vi.fn((_s: string, code: string) => answer({ ...state, locales: state.locales.filter((l) => l.code !== code) })),
    setLocalePrefixes: vi.fn((_s: string, prefixes: boolean) => answer({ ...state, prefixes })),
  };
  const store = { set: vi.fn() };
  const confirm = { ask: vi.fn(() => Promise.resolve(true)) };
  TestBed.configureTestingModule({
    imports: [LanguagesPage],
    providers: [
      provideRouter([]),
      { provide: ManagementApi, useValue: api },
      { provide: SpaceLocales, useValue: store },
      { provide: Confirm, useValue: confirm },
      { provide: DsToastService, useValue: { success: vi.fn() } },
      {
        provide: SpaceContext,
        useValue: {
          currentSpaceId: signal(null),
          viewingAs: signal(null),
          can: (permission: string) => permission !== 'schema.write' || role !== 'editor',
          canManageCurrent: signal(role === 'admin'),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(LanguagesPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name);
  const fill = async (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
    await settle(fixture);
  };
  const rows = () => [...el.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].slice(0, 4).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim()));
  return { fixture, el, api, store, confirm, button, fill, rows };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('LanguagesPage', () => {
  it('lists the languages, where their untranslated text comes from, and their addresses', async () => {
    const { rows } = await render({ prefixes: true });
    expect(rows()).toEqual([
      ['English (UK) (main language)', 'en-GB', 'Not needed', '/about'],
      ['Welsh', 'cy-GB', 'English (UK)', '/cy/about'],
    ]);
  });

  it('adds a language, naming it and choosing its prefix from the code', async () => {
    const { el, fixture, api, store, fill, button, rows } = await render({ role: 'developer' });
    await fill('language-code', 'fr-FR');
    expect(el.querySelector<HTMLInputElement>('#language-name')?.value).toBe('French (France)');
    expect(el.querySelector<HTMLInputElement>('#language-prefix')?.value).toBe('fr');
    button('Add language')?.click();
    await settle(fixture);
    expect(api.createLocale).toHaveBeenCalledWith(spaceId, { code: 'fr-FR', name: 'French (France)', prefix: 'fr', fallback: 'en-GB' });
    expect(rows().map((row) => row[0])).toContain('French (France)');
    expect(store.set).toHaveBeenCalled();
  });

  it('checks the code before asking the API', async () => {
    const { fixture, api, fill, button, el } = await render();
    await fill('language-code', 'French');
    button('Add language')?.click();
    await settle(fixture);
    expect(api.createLocale).not.toHaveBeenCalled();
    expect(el.querySelector('#language-code')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#language-code-hint')?.textContent).toContain('Use a language code like fr or fr-FR.');
  });

  it('changes the main language and removes a language, asking first', async () => {
    const { fixture, api, confirm, button } = await render();
    button('Make main language: Welsh')?.click();
    await settle(fixture);
    expect(confirm.ask).toHaveBeenCalled();
    expect(api.updateLocale).toHaveBeenCalledWith(spaceId, 'cy-GB', { isDefault: true });
    button('Remove English (UK)')?.click();
    await settle(fixture);
    expect(api.removeLocale).toHaveBeenCalledWith(spaceId, 'en-GB');
  });

  it('lets space admins put the language in addresses', async () => {
    const { el, fixture, api } = await render();
    const toggle = el.querySelector<HTMLInputElement>('#languages-prefixes') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(api.setLocalePrefixes).toHaveBeenCalledWith(spaceId, true);
  });

  it('is read only for editors', async () => {
    const { el, button } = await render({ role: 'editor' });
    expect(button('Add language')).toBeUndefined();
    expect(el.querySelector('#language-code')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('#languages-prefixes')?.disabled).toBe(true);
    expect(el.textContent).toContain('Only space admins can change this.');
  });
});
