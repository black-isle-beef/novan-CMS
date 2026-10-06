import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ViewAs } from './view-as';
import { viewAsReadOnlyInterceptor } from './view-as-read-only.interceptor';

const api = 'http://localhost:3000/v1/management/spaces/s1';

describe('viewAsReadOnlyInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let viewAs: ViewAs;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([viewAsReadOnlyInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    viewAs = TestBed.inject(ViewAs);
  });

  afterEach(() => backend.verify());

  it('lets every request through normally', async () => {
    const saved = firstValueFrom(http.patch(`${api}/entries/e1`, {}));
    backend.expectOne(`${api}/entries/e1`).flush({ ok: true });
    await expect(saved).resolves.toEqual({ ok: true });
  });

  it('refuses writes while viewing as, with a problem the screens can show, before anything is sent', async () => {
    viewAs.start('s1', 'editor');

    for (const request of [http.post(`${api}/entries`, {}), http.patch(api, {}), http.delete(`${api}/members/u1`), http.put('https://storage.example/upload', {})]) {
      const error = await firstValueFrom(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect((error as HttpErrorResponse).status).toBe(403);
      expect((error as HttpErrorResponse).error).toMatchObject({ code: 'view_as_read_only' });
    }
    backend.expectNone(() => true);
  });

  it('still reads, and still records stopping, while viewing as', async () => {
    viewAs.start('s1', 'viewer');

    const read = firstValueFrom(http.get(`${api}/entries`));
    backend.expectOne(`${api}/entries`).flush([]);
    await expect(read).resolves.toEqual([]);

    const audit = firstValueFrom(http.post(`${api}/view-as`, { role: null }));
    backend.expectOne(`${api}/view-as`).flush(null);
    await expect(audit).resolves.toBeNull();
  });
});
