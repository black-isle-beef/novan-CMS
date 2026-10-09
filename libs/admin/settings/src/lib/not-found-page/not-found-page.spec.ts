import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SpaceContext } from '@novan/admin-spaces';
import { of } from 'rxjs';
import { SettingsApi } from '../settings-api';
import { NotFoundPage } from './not-found-page';

const spaceId = '00000000-0000-4000-8000-000000000200';

async function render(canRedirect = true) {
  const api = {
    listNotFound: vi.fn((_s: string, query: { days: number }) =>
      of(
        query.days === 7
          ? []
          : [
              { path: '/old-shop', hits: 12, days: 4, lastSeenAt: '2026-10-08T10:00:00Z', lastReferrer: 'https://www.google.com/search?q=x' },
              { path: '/typo', hits: 1, days: 1, lastSeenAt: '2026-10-07T10:00:00Z', lastReferrer: null },
            ],
      ),
    ),
  };
  TestBed.configureTestingModule({
    imports: [NotFoundPage],
    providers: [
      provideRouter([]),
      { provide: SettingsApi, useValue: api },
      { provide: SpaceContext, useValue: { currentSpaceId: signal(null), canPublishCurrent: signal(canRedirect) } },
    ],
  });
  const fixture = TestBed.createComponent(NotFoundPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement, api };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('NotFoundPage', () => {
  it('lists the most visited missing addresses, with a link to redirect each', async () => {
    const { el, api } = await render();
    const rows = [...el.querySelectorAll('tbody tr')];

    expect(api.listNotFound).toHaveBeenCalledWith(spaceId, { days: 30, limit: 100 });
    expect(rows.map((row) => row.querySelector('code')?.textContent)).toEqual(['/old-shop', '/typo']);
    expect(rows[0].textContent).toContain('www.google.com');
    const redirect = rows[0].querySelector('a');
    expect(redirect?.getAttribute('href')).toBe(`/spaces/${spaceId}/settings/redirects?from=%2Fold-shop`);
  });

  it('covers another period', async () => {
    const { fixture, el, api } = await render();
    const select = el.querySelector<HTMLSelectElement>('#not-found-days') as HTMLSelectElement;
    select.value = '7';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(api.listNotFound).toHaveBeenLastCalledWith(spaceId, { days: 7, limit: 100 });
    expect(el.textContent).toContain('No missing pages in the last 7 days.');
  });

  it('offers no redirect to roles that cannot add one', async () => {
    const { el } = await render(false);

    expect(el.querySelector('tbody a')).toBeNull();
  });
});
