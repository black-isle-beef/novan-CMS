import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from '@black-isle-beef/novan-design-system';
import { SpaceContext } from '@novan/admin-spaces';
import { toBlockTypeFile, toContentTypeFile } from '@novan/schema-sync';
import type { BlockType, ContentType, GithubSchemaSource } from '@novan/shared-schemas';
import axe from 'axe-core';
import { of, throwError } from 'rxjs';
import { SchemaApi } from '../schema-api';
import { GithubSetupPage } from './github-setup-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const SHA = 'c'.repeat(40);
const base = { spaceId, environmentId: spaceId, createdAt: '', updatedAt: '' };
const text = (apiId: string) => ({ id: apiId, apiId, label: apiId, type: 'text' });

const pageFile = toContentTypeFile({
  apiId: 'page',
  name: 'Page',
  kind: 'page',
  fields: [text('title'), { id: 'body', apiId: 'body', label: 'Body', type: 'blocks', allowedBlocks: ['hero'] }],
});
const heroFile = toBlockTypeFile({ apiId: 'hero', name: 'Hero', fields: [text('heading')] });
const source: GithubSchemaSource = { repo: 'acme/site', ref: 'main', commitSha: SHA, path: 'novan/schema', contentTypes: [pageFile], blockTypes: [heroFile] };

const remotePage = (fields = pageFile.fields) => ({ ...base, id: 'p', ...pageFile, fields }) as ContentType;
const remoteBlock = (apiId: string, file = toBlockTypeFile({ apiId, name: apiId, fields: [text('a')] })) => ({ ...base, id: apiId, ...file, schemaVersion: 1 }) as BlockType;

async function settle(fixture: ComponentFixture<GithubSetupPage>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }
  await fixture.whenStable();
}

describe('GithubSetupPage', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let toasts: { success: ReturnType<typeof vi.fn> };

  async function render() {
    TestBed.configureTestingModule({
      imports: [GithubSetupPage],
      providers: [
        provideRouter([]),
        { provide: SchemaApi, useValue: api },
        { provide: DsToastService, useValue: toasts },
        { provide: SpaceContext, useValue: { currentSpaceId: signal(null), currentSpace: signal({ name: 'Acme', slug: 'acme-ltd' }) } },
      ],
    });
    const fixture = TestBed.createComponent(GithubSetupPage);
    fixture.componentRef.setInput('spaceId', spaceId);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const type = async (selector: string, value: string) => {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const tick = async (selector: string) => {
      el.querySelector<HTMLInputElement>(selector)!.click();
      await fixture.whenStable();
    };
    const submit = async (index: number) => {
      el.querySelectorAll('form')[index].dispatchEvent(new Event('submit'));
      await settle(fixture);
    };
    const check = async (repoUrl = 'https://github.com/acme/site') => {
      await type('#github-repo-url', repoUrl);
      await submit(0);
    };
    const applyButton = () => el.querySelectorAll('form')[1]?.querySelector<HTMLButtonElement>('button[type=submit]') ?? null;
    return { fixture, el, type, tick, submit, check, applyButton };
  }

  beforeEach(() => {
    toasts = { success: vi.fn() };
    api = {
      readGithubSchema: vi.fn().mockReturnValue(of(source)),
      listContentTypes: vi.fn().mockReturnValue(of([])),
      listBlockTypes: vi.fn().mockReturnValue(of([])),
      createContentType: vi.fn().mockReturnValue(of({})),
      updateContentType: vi.fn().mockReturnValue(of({})),
      deleteContentType: vi.fn().mockReturnValue(of(undefined)),
      createBlockType: vi.fn().mockReturnValue(of({})),
      updateBlockType: vi.fn().mockReturnValue(of({})),
      deleteBlockType: vi.fn().mockReturnValue(of(undefined)),
    };
  });

  it('refuses an address that is not a GitHub repo without calling the API', async () => {
    const { el, check } = await render();
    await check('https://gitlab.com/acme/site');

    expect(api['readGithubSchema']).not.toHaveBeenCalled();
    expect(el.querySelector('#github-repo-url')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#github-repo-url-hint')?.textContent).toContain('Enter a GitHub address');
  });

  it('shows what a new site gets, then creates it in dependency order', async () => {
    const { el, check, submit, applyButton } = await render();
    await check();

    expect(api['readGithubSchema']).toHaveBeenCalledWith(spaceId, { repoUrl: 'https://github.com/acme/site', path: 'novan/schema' });
    expect(el.textContent).toContain('acme/site at main (commit ccccccc)');
    expect([...el.querySelectorAll('section li.border-bottom')].map((li) => li.textContent?.trim())).toEqual(['Add content type page', 'Add block type hero']);
    expect(applyButton()?.textContent?.trim()).toBe('Apply 2 changes');
    expect(applyButton()?.disabled).toBe(false);

    await submit(1);

    expect(api['createBlockType'].mock.invocationCallOrder[0]).toBeLessThan(api['createContentType'].mock.invocationCallOrder[0]);
    expect(api['createContentType']).toHaveBeenCalledWith(spaceId, pageFile);
    expect(el.querySelector('[role=log]')?.textContent).toContain('Created content type page.');
    expect(el.textContent).toContain('The schema now matches commit ccccccc.');
    expect(toasts.success).toHaveBeenCalled();
  });

  it('says when the space already matches', async () => {
    api['listContentTypes'].mockReturnValue(of([remotePage()]));
    api['listBlockTypes'].mockReturnValue(of([remoteBlock('hero', heroFile)]));
    const { el, check, applyButton } = await render();
    await check();

    expect(el.textContent).toContain('The space already matches this commit.');
    expect(applyButton()).toBeNull();
  });

  it('needs Restore and the short name for destructive changes, then forces them', async () => {
    api['listContentTypes'].mockReturnValue(of([remotePage([...pageFile.fields, text('summary')] as ContentType['fields'])]));
    api['listBlockTypes'].mockReturnValue(of([remoteBlock('hero', heroFile), remoteBlock('old')]));
    const { el, check, tick, type, submit, applyButton } = await render();
    await check();

    expect(el.querySelectorAll('ds-badge').length).toBe(2);
    expect(el.textContent).toContain('Only a restore applies them.');
    expect(applyButton()?.disabled).toBe(true);

    await tick('#github-restore');
    expect(applyButton()?.textContent?.trim()).toBe('Restore the schema');
    expect(applyButton()?.disabled).toBe(true);
    await type('#github-confirm-slug', 'acme');
    expect(applyButton()?.disabled).toBe(true);
    await type('#github-confirm-slug', 'acme-ltd');
    expect(applyButton()?.disabled).toBe(false);

    await submit(1);

    expect(api['updateContentType']).toHaveBeenCalledWith(spaceId, 'page', expect.objectContaining({ fields: pageFile.fields }), true);
    expect(api['deleteBlockType']).toHaveBeenCalledWith(spaceId, 'old', true);
    expect(el.textContent).toContain('The schema now matches commit ccccccc.');
  });

  it('shows why the repo could not be read', async () => {
    api['readGithubSchema'].mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404, error: { code: 'repo_not_found', detail: 'GitHub has no repo acme/site that the API can read.' } })),
    );
    const { el, check } = await render();
    await check();

    expect(el.querySelector('ds-alert')?.textContent).toContain('GitHub has no repo acme/site');
    expect(el.textContent).not.toContain('What would change');
  });

  it('reports an API refusal during the push, line by line', async () => {
    api['createContentType'].mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'unknown_reference', detail: 'Unknown block type cta.' } })),
    );
    const { el, check, submit } = await render();
    await check();
    await submit(1);

    expect(el.querySelector('[role=log]')?.textContent).toContain('Created block type hero.');
    expect(el.querySelector('section ds-alert')?.textContent).toContain('content type page: Unknown block type cta.');
    expect(el.textContent).not.toContain('The schema now matches');
  });

  it('has no axe violations with changes to restore', async () => {
    api['listBlockTypes'].mockReturnValue(of([remoteBlock('old')]));
    const { el, check, tick } = await render();
    await check();
    await tick('#github-restore');

    const results = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
