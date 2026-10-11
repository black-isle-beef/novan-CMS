import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_CONFIG } from '@novan/admin-auth';
import type { Download } from '@novan/admin-shell';
import type {
  FormSettings,
  FormSubmission,
  FormSubmissionsPage,
  FormSubmissionsQuery,
  FormSummary,
  UpdateFormSettingsRequest,
} from '@novan/shared-schemas';
import { map, type Observable } from 'rxjs';

/** Typed client for the Forms inbox, `/v1/management/spaces/:spaceId/forms` (docs/build/18-search-forms-audit.md). */
@Injectable({ providedIn: 'root' })
export class FormsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(ADMIN_CONFIG).apiUrl}/v1/management/spaces`;

  forms(spaceId: string): Observable<FormSummary[]> {
    return this.http.get<FormSummary[]>(`${this.base}/${spaceId}/forms`);
  }

  submissions(spaceId: string, query: FormSubmissionsQuery = {}): Observable<FormSubmissionsPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params = params.set(key, String(value));
    return this.http.get<FormSubmissionsPage>(`${this.base}/${spaceId}/forms/submissions`, { params });
  }

  submission(spaceId: string, id: string): Observable<FormSubmission> {
    return this.http.get<FormSubmission>(`${this.base}/${spaceId}/forms/submissions/${id}`);
  }

  deleteSubmission(spaceId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${spaceId}/forms/submissions/${id}`);
  }

  /** One form's submissions as a CSV file. */
  export(spaceId: string, formUid: string): Observable<Download> {
    return this.http
      .get(`${this.base}/${spaceId}/forms/submissions/export`, { params: { form: formUid }, responseType: 'blob', observe: 'response' })
      .pipe(
        map((response) => ({
          blob: response.body ?? new Blob([]),
          filename: /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'form-submissions.csv',
        })),
      );
  }

  settings(spaceId: string): Observable<FormSettings> {
    return this.http.get<FormSettings>(`${this.base}/${spaceId}/forms/settings`);
  }

  updateSettings(spaceId: string, body: UpdateFormSettingsRequest): Observable<FormSettings> {
    return this.http.put<FormSettings>(`${this.base}/${spaceId}/forms/settings`, body);
  }
}

