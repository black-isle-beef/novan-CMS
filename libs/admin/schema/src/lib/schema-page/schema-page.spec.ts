import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SpaceContext } from '@novan/admin-spaces';
import type { BlockType, ContentType } from '@novan/shared-schemas';
import { of } from 'rxjs';
import { SchemaApi } from '../schema-api';
import { SchemaPage } from './schema-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const base = { spaceId, environmentId: spaceId, createdAt: '', updatedAt: '' };

describe('SchemaPage', () => {
  it('lists content types and block types with links to edit them', async () => {
    const page: ContentType = { ...base, id: 'p', apiId: 'page', name: 'Page', kind: 'page', description: null, fields: [] };
    const hero: BlockType = {
      ...base,
      id: 'h',
      apiId: 'hero',
      name: 'Hero',
      icon: 'window-fullscreen',
      previewImagePath: null,
      fields: [],
      allowedChildren: [],
      styleOptions: {},
      schemaVersion: 2,
    };
    TestBed.configureTestingModule({
      imports: [SchemaPage],
      providers: [
        provideRouter([]),
        { provide: SchemaApi, useValue: { listContentTypes: () => of([page]), listBlockTypes: () => of([hero]) } },
        { provide: SpaceContext, useValue: { currentSpaceId: signal(null), currentSpace: signal({ name: 'Demo site' }) } },
      ],
    });
    const fixture = TestBed.createComponent(SchemaPage);
    fixture.componentRef.setInput('spaceId', spaceId);
    await fixture.whenStable();
    // Both lists load in parallel; let the promises settle, then render.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h1')?.textContent).toBe('Schema');
    expect([...el.querySelectorAll('caption')].map((c) => c.textContent?.trim())).toEqual(['Content types', 'Block types']);
    const links = [...el.querySelectorAll<HTMLAnchorElement>('tbody th a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Page', `/spaces/${spaceId}/schema/content-types/page`],
      ['Hero', `/spaces/${spaceId}/schema/block-types/hero`],
    ]);
    expect(el.querySelector('tbody th i')?.getAttribute('aria-hidden')).toBe('true');
  });
});
