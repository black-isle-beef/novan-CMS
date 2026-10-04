import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { UploadUrlResponse } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { MediaApi } from '../media-api';
import { asset } from '../testing';
import { MediaUploader } from './uploader';

const spaceId = '00000000-0000-4000-8000-000000000200';

function setup() {
  const target = (file: File): UploadUrlResponse => ({
    assetId: asset(1).id,
    filename: file.name,
    mime: 'image/png',
    uploadUrl: 'https://storage.example/upload',
    maxBytes: 20 * 1024 * 1024,
  });
  const api = {
    uploadUrl: vi.fn((_s: string, file: File) =>
      file.name.endsWith('.html')
        ? throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: { code: 'file_type_not_allowed', detail: 'This type of file cannot be added.' },
              }),
          )
        : of(target(file)),
    ),
    put: vi.fn(async (_t: UploadUrlResponse, _f: File, progress: (percent: number) => void) => {
      progress(50);
      progress(100);
    }),
    complete: vi.fn(() => of({ ...asset(1), usages: [] })),
  };
  TestBed.configureTestingModule({ imports: [MediaUploader], providers: [{ provide: MediaApi, useValue: api }] });
  const fixture = TestBed.createComponent(MediaUploader);
  fixture.componentRef.setInput('spaceId', spaceId);
  fixture.componentRef.setInput('folder', 'Brand');
  const uploaded = vi.fn();
  fixture.componentInstance.uploaded.subscribe(uploaded);
  const el = fixture.nativeElement as HTMLElement;
  const choose = async (...files: File[]) => {
    const input = el.querySelector<HTMLInputElement>('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(el.textContent).not.toContain('Uploading'));
    await fixture.whenStable();
  };
  return { api, fixture, el, choose, uploaded };
}

describe('MediaUploader', () => {
  it('has a labelled file chooser that offers only accepted types', async () => {
    const { fixture, el } = setup();
    fixture.componentRef.setInput('accept', ['file']);
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('input[type=file]') as HTMLInputElement;
    expect(el.querySelector(`label[for="${input.id}"]`)?.textContent).toContain('Upload files');
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('.pdf');
    expect(input.accept).not.toContain('.jpg');
  });

  it('uploads each file to storage, then adds it to the library in the current folder', async () => {
    const { api, el, choose, uploaded } = setup();
    await choose(new File(['a'], 'one.png', { type: 'image/png' }), new File(['b'], 'two.png', { type: 'image/png' }));

    expect(api.uploadUrl).toHaveBeenCalledTimes(2);
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.complete).toHaveBeenCalledWith(spaceId, { assetId: asset(1).id, filename: 'one.png', folder: 'Brand' });
    expect(uploaded).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('2 files uploaded.');
    expect(el.textContent).toContain('Added to the library.');
  });

  it('says why a file was not added', async () => {
    const { el, choose, uploaded } = setup();
    await choose(
      new File(['<html>'], 'page.html', { type: 'text/html' }),
      new File(['a'], 'ok.png', { type: 'image/png' }),
    );

    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('1 uploaded, 1 not added.');
    expect(el.textContent).toContain('This type of file cannot be added.');
  });
});
