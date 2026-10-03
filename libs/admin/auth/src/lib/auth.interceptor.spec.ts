import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ADMIN_CONFIG } from './admin-config';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { createFakeAuth, type FakeAuth, fakeSession } from './testing';

describe('authInterceptor', () => {
  let auth: FakeAuth;
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    auth = createFakeAuth(fakeSession({ sub: 'u', n: 1 }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: ADMIN_CONFIG, useValue: { apiUrl: 'http://api.test', supabaseUrl: '', supabaseAnonKey: '' } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('adds the access token to API calls only', () => {
    void firstValueFrom(http.get('http://api.test/v1/management/me'));
    void firstValueFrom(http.get('https://elsewhere.test/data'));

    expect(backend.expectOne('http://api.test/v1/management/me').request.headers.get('Authorization')).toBe(
      `Bearer ${auth.accessToken()}`,
    );
    expect(backend.expectOne('https://elsewhere.test/data').request.headers.has('Authorization')).toBe(false);
  });

  it('refreshes the session once on 401 and retries with the new token', async () => {
    const refreshed = fakeSession({ sub: 'u', n: 2 });
    auth.refresh.mockResolvedValue(refreshed);
    const result = firstValueFrom(http.get('http://api.test/v1/management/spaces'));

    backend.expectOne('http://api.test/v1/management/spaces').flush(null, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    await Promise.resolve();
    const retry = backend.expectOne('http://api.test/v1/management/spaces');
    retry.flush([]);

    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${refreshed.access_token}`);
    expect(await result).toEqual([]);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it('signs out when the session cannot be refreshed', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const result = firstValueFrom(http.get('http://api.test/v1/management/spaces'));

    backend.expectOne('http://api.test/v1/management/spaces').flush(null, { status: 401, statusText: 'Unauthorized' });

    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.signOut).toHaveBeenCalled();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/sign-in']));
  });

  it('passes other errors through without refreshing', async () => {
    const result = firstValueFrom(http.get('http://api.test/v1/management/spaces'));

    backend.expectOne('http://api.test/v1/management/spaces').flush(null, { status: 403, statusText: 'Forbidden' });

    await expect(result).rejects.toMatchObject({ status: 403 });
    expect(auth.refresh).not.toHaveBeenCalled();
  });
});
