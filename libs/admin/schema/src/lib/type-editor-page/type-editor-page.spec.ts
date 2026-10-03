import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SpaceContext } from '@novan/admin-spaces';
import { type ContentType, fieldListSchema } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { SchemaApi } from '../schema-api';
import { TypeEditorPage } from './type-editor-page';

const spaceId = '00000000-0000-4000-8000-000000000200';

/** Lets the page's API promises resolve, then renders. */
async function settle(fixture: ComponentFixture<TypeEditorPage>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
}

const article: ContentType = {
  id: '00000000-0000-4000-8000-0000000000a1',
  spaceId,
  environmentId: '00000000-0000-4000-8000-0000000000e1',
  apiId: 'article',
  name: 'Article',
  kind: 'entry',
  description: null,
  fields: fieldListSchema.parse([{ id: 'title', apiId: 'title', label: 'Title', type: 'text' }]),
  createdAt: '',
  updatedAt: '',
};

describe('TypeEditorPage', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  async function render(inputs: { apiId?: string; kind?: 'content-types' | 'block-types' } = {}) {
    TestBed.configureTestingModule({
      imports: [TypeEditorPage],
      providers: [
        provideRouter([]),
        { provide: SchemaApi, useValue: api },
        { provide: SpaceContext, useValue: { currentSpaceId: signal(null), currentSpace: signal(null) } },
      ],
    });
    const fixture = TestBed.createComponent(TypeEditorPage);
    fixture.componentRef.setInput('spaceId', spaceId);
    fixture.componentRef.setInput('kind', inputs.kind ?? 'content-types');
    if (inputs.apiId) fixture.componentRef.setInput('apiId', inputs.apiId);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const type = async (selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const submit = async () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle(fixture);
    };
    return { fixture, el, type, submit };
  }

  beforeEach(() => {
    api = {
      listContentTypes: vi.fn().mockReturnValue(of([article])),
      listBlockTypes: vi.fn().mockReturnValue(of([])),
      createContentType: vi.fn().mockReturnValue(of({ ...article, apiId: 'blogPost', name: 'Blog post' })),
      updateContentType: vi.fn(),
      createBlockType: vi.fn(),
      updateBlockType: vi.fn(),
      deleteContentType: vi.fn(),
      deleteBlockType: vi.fn(),
    };
  });

  it('creates a content type with an API id derived from its name, then opens it', async () => {
    const { el, type, submit } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    expect(el.querySelector('h1')?.textContent).toContain('New content type');
    await type('#type-name', 'Blog post');
    expect(el.querySelector<HTMLInputElement>('#type-api-id')?.value).toBe('blogPost');
    el.querySelector<HTMLInputElement>('#type-kind-entry')!.click();
    await submit();

    expect(api['createContentType']).toHaveBeenCalledWith(spaceId, {
      apiId: 'blogPost',
      kind: 'entry',
      name: 'Blog post',
      fields: [],
      description: null,
    });
    expect(navigate).toHaveBeenCalledWith(['/spaces', spaceId, 'schema', 'content-types', 'blogPost'], {
      queryParams: { created: 1 },
    });
  });

  it('shows the live JSON preview of the request', async () => {
    const { el, type } = await render();
    await type('#type-name', 'Event');

    expect(JSON.parse(el.querySelector('details pre')?.textContent ?? '{}')).toMatchObject({ apiId: 'event', name: 'Event' });
  });

  it('checks the request with the shared schema before sending it', async () => {
    const { el, submit } = await render();
    await submit();

    expect(api['createContentType']).not.toHaveBeenCalled();
    const summary = el.querySelector<HTMLElement>('#type-editor-errors');
    expect(summary?.textContent).toContain('Fix these before saving');
    expect(summary?.textContent).toContain('API id');
    expect(document.activeElement).toBe(summary);
  });

  it('offers to save anyway when a change would invalidate entries, then forces it', async () => {
    api['updateContentType']
      .mockReturnValueOnce(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: 'entries_invalidated', affectedEntries: 3, detail: 'This change would make 3 existing entries invalid.' },
            }),
        ),
      )
      .mockReturnValueOnce(of({ ...article, name: 'Articles' }));
    const { fixture, el, type, submit } = await render({ apiId: 'article' });

    expect(el.querySelector('h1')?.textContent).toContain('Article');
    await type('#type-name', 'Articles');
    await submit();

    expect(el.textContent).toContain('3 existing entries invalid');
    const anyway = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save anyway')!;
    anyway.click();
    await settle(fixture);

    expect(api['updateContentType']).toHaveBeenLastCalledWith(spaceId, 'article', expect.objectContaining({ name: 'Articles' }), true);
    expect(el.querySelector('#type-editor-status')?.textContent).toContain('Saved Articles.');
  });

  it('says so when the type does not exist', async () => {
    const { el } = await render({ apiId: 'missing' });

    expect(el.querySelector('ds-alert')?.textContent).toContain('There is no content type "missing" in this space.');
  });
});
