import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  DsAlertComponent,
  DsBadgeComponent,
  DsButtonComponent,
  DsModalComponent,
  DsSpinnerComponent,
} from '@black-isle-beef/novan-design-system';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import type { ApiToken, ApiTokenScope, CreatedApiToken } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { SettingsApi } from '../settings-api';

/** What each kind of token is for, in the words the screen uses. */
export const tokenKinds: readonly { scope: ApiTokenScope; label: string; description: string }[] = [
  {
    scope: 'delivery',
    label: 'Delivery',
    description: 'Reads published content. Use it on your live website.',
  },
  {
    scope: 'preview',
    label: 'Preview',
    description: 'Also reads drafts. Use it only on a preview server, never in code that runs in a browser.',
  },
];

/**
 * The space's API tokens: list, create (the secret is shown once) and revoke. For admins, developers and
 * agency staff; the route guard, the API and RLS agree.
 */
@Component({
  selector: 'nv-api-tokens-page',
  imports: [DatePipe, DsAlertComponent, DsBadgeComponent, DsButtonComponent, DsModalComponent, DsSpinnerComponent, ReactiveFormsModule],
  templateUrl: './api-tokens-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiTokensPage {
  private readonly api = inject(SettingsApi);
  private readonly injector = inject(Injector);
  protected readonly context = inject(SpaceContext);

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly tokenKinds = tokenKinds;
  protected readonly tokens = signal<ApiToken[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly submitted = signal(false);
  /** The token just created, with its secret, until the page is left. */
  protected readonly created = signal<CreatedApiToken | null>(null);
  protected readonly copyStatus = signal<string | null>(null);
  protected readonly revoking = signal<ApiToken | null>(null);
  protected readonly revokeHeading = computed(() => `Revoke ${this.revoking()?.name ?? 'token'}?`);

  private readonly createdHeading = viewChild<ElementRef<HTMLElement>>('createdHeading');

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    scope: ['delivery' as ApiTokenScope, Validators.required],
  });

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId);
      });
    });
  }

  protected nameInvalid(): boolean {
    return this.submitted() && this.form.controls.name.invalid;
  }

  protected kindLabel(scope: ApiTokenScope): string {
    return tokenKinds.find((kind) => kind.scope === scope)?.label ?? scope;
  }

  protected async create(): Promise<void> {
    this.submitted.set(true);
    this.clearMessages();
    if (this.form.invalid) return;

    const { name, scope } = this.form.getRawValue();
    this.creating.set(true);
    try {
      const token = await firstValueFrom(this.api.createApiToken(this.spaceId(), { name: name.trim(), scope }));
      this.tokens.update((list) => [token, ...(list ?? [])]);
      this.created.set(token);
      this.copyStatus.set(null);
      this.form.reset();
      this.submitted.set(false);
      // Take keyboard and screen reader users to the token they need to copy.
      afterNextRender(() => this.createdHeading()?.nativeElement.focus(), { injector: this.injector });
    } catch (error) {
      this.actionError.set(problemMessage(error));
    } finally {
      this.creating.set(false);
    }
  }

  protected async copy(field: HTMLInputElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(field.value);
      this.copyStatus.set('Copied to the clipboard.');
    } catch {
      field.select();
      this.copyStatus.set('Your browser did not allow copying. The token is selected: copy it with Ctrl+C or Cmd+C.');
    }
  }

  protected confirmRevoke(token: ApiToken): void {
    this.clearMessages();
    this.revoking.set(token);
  }

  protected async revoke(): Promise<void> {
    const token = this.revoking();
    this.revoking.set(null);
    if (!token) return;
    try {
      const revoked = await firstValueFrom(this.api.revokeApiToken(this.spaceId(), token.id));
      this.tokens.update((list) => (list ?? []).map((t) => (t.id === revoked.id ? revoked : t)));
      if (this.created()?.id === revoked.id) this.created.set(null);
      this.status.set(`${token.name} is revoked. Sites using it no longer receive content.`);
    } catch (error) {
      this.actionError.set(problemMessage(error));
    }
  }

  private async load(spaceId: string): Promise<void> {
    this.tokens.set(null);
    this.loadError.set(null);
    this.created.set(null);
    this.clearMessages();
    try {
      this.tokens.set(await firstValueFrom(this.api.listApiTokens(spaceId)));
    } catch (error) {
      this.loadError.set(problemMessage(error));
    }
  }

  private clearMessages(): void {
    this.status.set(null);
    this.actionError.set(null);
  }
}
