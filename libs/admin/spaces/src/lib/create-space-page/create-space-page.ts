import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { AuthService } from '@novan/admin-auth';
import { firstValueFrom } from 'rxjs';
import { ManagementApi } from '../management-api';
import { problemFieldErrors, problemMessage } from '../problem';
import { SpaceContext } from '../space-context';

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Suggests a web-address-safe short name from a display name. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/** Agency staff create a client space; they become its first admin. */
@Component({
  selector: 'nv-create-space-page',
  imports: [DsAlertComponent, ReactiveFormsModule, RouterLink],
  templateUrl: './create-space-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateSpacePage {
  private readonly api = inject(ManagementApi);
  private readonly auth = inject(AuthService);
  private readonly context = inject(SpaceContext);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly serverErrors = signal<Record<string, string[]>>({});
  private slugEdited = false;

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    slug: [
      '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(63), Validators.pattern(slugPattern)],
    ],
  });

  protected nameChanged(): void {
    if (!this.slugEdited) this.form.controls.slug.setValue(slugify(this.form.controls.name.value));
  }

  protected slugChanged(): void {
    this.slugEdited = true;
  }

  protected invalid(name: 'name' | 'slug'): boolean {
    return (this.submitted() && this.form.controls[name].invalid) || !!this.serverErrors()[name];
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    this.serverErrors.set({});
    if (this.form.invalid) return;

    this.busy.set(true);
    try {
      const space = await firstValueFrom(this.api.createSpace(this.form.getRawValue()));
      // The new membership reaches the access token on refresh.
      await this.auth.refresh();
      await this.context.load();
      // New spaces open on their dashboard, with the getting-started checklist.
      await this.router.navigate(['/spaces', space.id]);
    } catch (error) {
      this.error.set(problemMessage(error));
      this.serverErrors.set(problemFieldErrors(error));
    } finally {
      this.busy.set(false);
    }
  }
}
