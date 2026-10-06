import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { DsAlertComponent, DsToastService } from '@black-isle-beef/novan-design-system';
import { type HasUnsavedChanges, Shortcuts, shortcutKeys, Skeleton, warnBeforeUnload } from '@novan/admin-shell';
import { ManagementApi, problemFieldErrors, problemMessage, SpaceContext } from '@novan/admin-spaces';
import { firstValueFrom } from 'rxjs';

/** Space admins and agency staff rename the space and set the address of its site (used for "View live page"). */
@Component({
  selector: 'nv-space-settings-page',
  imports: [DsAlertComponent, ReactiveFormsModule, Skeleton],
  templateUrl: './space-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpaceSettingsPage implements HasUnsavedChanges {
  private readonly api = inject(ManagementApi);
  private readonly toasts = inject(DsToastService);
  protected readonly context = inject(SpaceContext);
  protected readonly shortcutKeys = shortcutKeys;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly serverErrors = signal<Record<string, string[]>>({});

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    previewUrl: ['', [Validators.maxLength(2048), Validators.pattern(/^https?:\/\/\S+$/i)]],
  });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly space = computed(() => this.context.currentSpace());
  private readonly dirty = computed(() => {
    const space = this.space();
    const value = this.value();
    return space !== null && (value.name !== space.name || (value.previewUrl ?? '') !== (space.previewUrl ?? ''));
  });

  constructor() {
    effect(() => {
      this.spaceId();
      const space = this.space();
      if (space) untracked(() => this.form.reset({ name: space.name, previewUrl: space.previewUrl ?? '' }));
    });
    inject(Shortcuts).register('save', () => void this.submit());
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.dirty() && !this.busy();
  }

  protected invalid(name: 'name' | 'previewUrl'): boolean {
    return (this.submitted() && this.form.controls[name].invalid) || !!this.serverErrors()[name];
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    this.serverErrors.set({});
    if (this.form.invalid || this.busy()) return;

    const { name, previewUrl } = this.form.getRawValue();
    this.busy.set(true);
    try {
      const space = await firstValueFrom(
        this.api.updateSpace(this.spaceId(), { name: name.trim(), previewUrl: previewUrl.trim() || null }),
      );
      this.context.replace(space);
      this.submitted.set(false);
      this.toasts.success('Space settings saved.');
    } catch (error) {
      this.error.set(problemMessage(error));
      this.serverErrors.set(problemFieldErrors(error));
    } finally {
      this.busy.set(false);
    }
  }
}
