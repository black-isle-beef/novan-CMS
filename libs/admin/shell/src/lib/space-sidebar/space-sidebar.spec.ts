import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import { firstValueFrom } from 'rxjs';
import { SpacePages } from './space-sidebar';

const spaceId = '00000000-0000-4000-8000-000000000200';

describe('SpacePages', () => {
  it('lists only the space\'s pages, by title', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: ADMIN_CONFIG, useValue: { apiUrl: 'http://api.test' } }, provideHttpClient(), provideHttpClientTesting()],
    });
    const pages = firstValueFrom(TestBed.inject(SpacePages).list(spaceId));
    TestBed.inject(HttpTestingController)
      .expectOne(`http://api.test/v1/management/spaces/${spaceId}/entries`)
      .flush([
        { id: '1', title: 'Home', kind: 'page' },
        { id: '2', title: 'Footer', kind: 'singleton' },
        { id: '3', title: 'About', kind: 'page' },
        { id: '4', title: 'A post', kind: 'entry' },
      ]);
    expect((await pages).map((page) => page.title)).toEqual(['About', 'Home']);
  });
});