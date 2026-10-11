import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { defineBlocks } from './blocks';
import { NOVAN_BRIDGE_LOADER, type NovanCmsConfig } from './config';
import { NovanApiError } from './content.service';
import { NovanForms, type NovanFormSubmission } from './forms';
import { NovanPreview } from './preview';
import { provideNovanCms } from './provide';

const submission: NovanFormSubmission = { entryId: '00000000-0000-4000-8000-000000000703', data: { email: 'ada@example.com', consent: true } };
const FORM = '00000000-0000-4000-8000-000000000924';

function setup(platform: 'browser' | 'server' = 'browser', config: Partial<NovanCmsConfig> = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: platform },
      { provide: NOVAN_BRIDGE_LOADER, useValue: () => Promise.reject(new Error('no bridge in tests')) },
      provideNovanCms({ blocks: defineBlocks({}), ...config }),
    ],
  });
  return { forms: TestBed.inject(NovanForms), http: TestBed.inject(HttpTestingController) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('NovanForms', () => {
  it('sends answers through the site\'s server, without a token', async () => {
    const { forms, http } = setup();
    const sent = forms.submit(FORM, submission);
    await settle();
    const req = http.expectOne(`/_novan/delivery/forms/${FORM}/submit`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(submission);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush('', { status: 202, statusText: 'Accepted' });
    await expect(sent).resolves.toBeUndefined();
  });

  it('sends straight to the API with a public delivery token', async () => {
    const { forms, http } = setup('browser', { apiUrl: 'https://api.example.com/', publicDeliveryToken: 'nv_del_public' });
    const sent = forms.submit(FORM, submission);
    await settle();
    const req = http.expectOne(`https://api.example.com/v1/delivery/forms/${FORM}/submit`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer nv_del_public');
    req.flush('', { status: 202, statusText: 'Accepted' });
    await sent;
  });

  it('reports refused answers by field', async () => {
    const { forms, http } = setup();
    const sent = forms.submit(FORM, submission);
    await settle();
    http
      .expectOne(`/_novan/delivery/forms/${FORM}/submit`)
      .flush(
        { code: 'form_invalid', detail: 'Some answers need attention.', errors: { email: ['Enter an email address.'] } },
        { status: 400, statusText: 'Bad Request' },
      );
    const error = (await sent.catch((e: unknown) => e)) as NovanApiError;
    expect(error).toBeInstanceOf(NovanApiError);
    expect(error).toMatchObject({ status: 400, code: 'form_invalid', message: 'Some answers need attention.' });
    expect(error.errors).toEqual({ email: ['Enter an email address.'] });
  });

  it('never sends from the server or in preview', async () => {
    await expect(setup('server').forms.submit(FORM, submission)).rejects.toMatchObject({ code: 'browser_only' });
    TestBed.resetTestingModule();
    const { forms, http } = setup();
    // As when the admin's signed preview link was accepted.
    (TestBed.inject(NovanPreview) as unknown as { activeState: WritableSignal<boolean> }).activeState.set(true);
    await expect(forms.submit(FORM, submission)).rejects.toMatchObject({ code: 'preview' });
    http.verify();
  });
});
