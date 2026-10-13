import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { type AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import {
  type DecideDeviceAuthorizationRequest,
  type DeviceAuthorizationDecision,
  formatUserCode,
  normaliseUserCode,
  userCodeSchema,
} from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { ADMIN_CONFIG } from '../admin-config';
import { AuthService } from '../auth.service';

/** Eight consonants, with or without the hyphen, upper or lower case. */
function userCode(control: AbstractControl<string>): ValidationErrors | null {
  return userCodeSchema.safeParse(control.value).success ? null : { userCode: true };
}

/** Plain-language message for a failed decision. */
function decisionError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'We could not reach Novan CMS. Check your connection and try again.';
    const detail = (error.error as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string') return detail;
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Approves or denies a sign-in started by `novan login` (docs/build/19-schema-cli-starter-kits.md). The person types
 * the code their terminal shows (or follows the link the CLI opened, which fills it in) and checks it matches.
 */
@Component({
  selector: 'nv-device-page',
  imports: [DsAlertComponent, ReactiveFormsModule, RouterLink],
  templateUrl: './device-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicePage {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ADMIN_CONFIG);
  private readonly injector = inject(Injector);
  protected readonly auth = inject(AuthService);

  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly decision = signal<DeviceAuthorizationDecision['status'] | null>(null);
  private readonly result = viewChild<ElementRef<HTMLElement>>('result');

  protected readonly form = inject(NonNullableFormBuilder).group({
    code: [this.codeFromLink(), [Validators.required, userCode]],
  });

  protected invalid(): boolean {
    return this.submitted() && this.form.controls.code.invalid;
  }

  protected async decide(approve: boolean): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid) return;

    this.busy.set(true);
    try {
      const body: DecideDeviceAuthorizationRequest = { userCode: this.form.controls.code.value, approve };
      const { status } = await firstValueFrom(
        this.http.post<DeviceAuthorizationDecision>(`${this.config.apiUrl}/v1/management/device-authorizations/decide`, body),
      );
      this.decision.set(status);
      // The form is gone; move focus to what happened so it is announced.
      afterNextRender(() => this.result()?.nativeElement.focus(), { injector: this.injector });
    } catch (error) {
      this.error.set(decisionError(error));
    } finally {
      this.busy.set(false);
    }
  }

  private codeFromLink(): string {
    const code = inject(ActivatedRoute).snapshot.queryParamMap.get('code') ?? '';
    return normaliseUserCode(code).length === 8 ? formatUserCode(code) : '';
  }
}
