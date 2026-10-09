import { ChangeDetectionStrategy, Component, computed, DOCUMENT, effect, inject, Injector, input, signal, untracked, afterNextRender } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DsAlertComponent, DsToastService } from '@black-isle-beef/novan-design-system';
import { Confirm, copy, Skeleton } from '@novan/admin-shell';
import { problemFieldErrors, problemMessage, SpaceContext } from '@novan/admin-spaces';
import {
  createRedirectRequestSchema,
  MAX_REDIRECT_IMPORT,
  type ParsedRedirectsCsv,
  parseRedirectsCsv,
  type Redirect,
  type RedirectStatus,
  redirectsCsv,
} from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { SettingsApi } from '../settings-api';

/** Largest CSV file the import reads. */
const MAX_CSV_BYTES = 2 * 1024 * 1024;

/**
 * Redirects (docs/build/14-seo-site-features.md): old addresses on the site and where they now go. Everyone in the
 * space sees them; editors and up add, change and delete them, import them from a CSV file (checked here first, line
 * by line) and export them. Redirects the CMS made when a page's address changed are marked as automatic. The
 * missing pages screen opens this one with `?from=` to redirect an address.
 */
@Component({
  selector: 'nv-redirects-page',
  imports: [DsAlertComponent, ReactiveFormsModule, RouterLink, Skeleton],
  templateUrl: './redirects-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RedirectsPage {
  private readonly api = inject(SettingsApi);
  private readonly confirm = inject(Confirm);
  private readonly toasts = inject(DsToastService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly context = inject(SpaceContext);
  protected readonly copy = copy;
  protected readonly maxImport = MAX_REDIRECT_IMPORT;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();
  /** `?from=`: an address to redirect, from the missing pages screen. */
  readonly from = input<string | undefined>(undefined);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly redirects = signal<Redirect[]>([]);
  protected readonly search = signal('');
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly serverErrors = signal<Record<string, string[]>>({});
  protected readonly submitted = signal(false);
  /** The redirect being changed in the form, or null when adding. */
  protected readonly editing = signal<Redirect | null>(null);
  protected readonly parsed = signal<(ParsedRedirectsCsv & { file: string }) | null>(null);
  protected readonly importProblem = signal<string | null>(null);
  protected readonly importResult = signal<string | null>(null);

  protected readonly canChange = computed(() => this.context.canPublishCurrent());

  protected readonly form = inject(NonNullableFormBuilder).group({
    fromPath: ['', [Validators.required, Validators.maxLength(1024)]],
    toPath: ['', [Validators.required, Validators.maxLength(2048)]],
    status: [301 as RedirectStatus],
  });

  protected readonly shown = computed(() => {
    const query = this.search().trim().toLowerCase();
    const all = this.redirects();
    return query ? all.filter((r) => r.fromPath.toLowerCase().includes(query) || r.toPath.toLowerCase().includes(query)) : all;
  });

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId);
      });
    });
    effect(() => {
      const from = this.from();
      if (from) untracked(() => this.form.patchValue({ fromPath: from }));
    });
  }

  protected invalid(name: 'fromPath' | 'toPath'): boolean {
    return (this.submitted() && this.form.controls[name].invalid) || !!this.serverErrors()[name];
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected edit(redirect: Redirect): void {
    this.editing.set(redirect);
    this.form.reset({ fromPath: redirect.fromPath, toPath: redirect.toPath, status: redirect.status });
    this.serverErrors.set({});
    this.focus('redirect-from');
  }

  protected cancelEdit(): void {
    this.editing.set(null);
    this.form.reset({ fromPath: '', toPath: '', status: 301 });
    this.submitted.set(false);
    this.serverErrors.set({});
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.problem.set(null);
    this.serverErrors.set({});
    if (this.form.invalid || this.busy()) return;
    // The same checks as the API, so mistakes show at once and in the same words.
    const parsed = createRedirectRequestSchema.safeParse(this.form.getRawValue());
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) (errors[String(issue.path[0] ?? 'toPath')] ??= []).push(issue.message);
      this.serverErrors.set(errors);
      return;
    }
    const editing = this.editing();
    this.busy.set(true);
    try {
      const saved = editing
        ? await firstValueFrom(this.api.updateRedirect(this.spaceId(), editing.id, parsed.data))
        : await firstValueFrom(this.api.createRedirect(this.spaceId(), parsed.data));
      this.redirects.update((all) => sorted([...all.filter((r) => r.id !== saved.id), saved]));
      this.toasts.success(editing ? `Redirect from ${saved.fromPath} changed.` : `${saved.fromPath} now redirects to ${saved.toPath}.`);
      this.cancelEdit();
      this.focus('redirect-from');
    } catch (error) {
      this.problem.set(problemMessage(error));
      this.serverErrors.set(problemFieldErrors(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(redirect: Redirect): Promise<void> {
    const confirmed = await this.confirm.ask({
      heading: `Delete the redirect from ${redirect.fromPath}?`,
      body: `Visitors to ${redirect.fromPath} will see “page not found” instead of going to ${redirect.toPath}.`,
      confirmLabel: 'Delete redirect',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await firstValueFrom(this.api.deleteRedirect(this.spaceId(), redirect.id));
      this.redirects.update((all) => all.filter((r) => r.id !== redirect.id));
      this.toasts.success(`Redirect from ${redirect.fromPath} deleted.`);
      this.focus('redirects-heading');
    } catch (error) {
      this.problem.set(problemMessage(error));
    }
  }

  // --- CSV ---

  protected async readCsv(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.importProblem.set(null);
    this.importResult.set(null);
    this.parsed.set(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      this.importProblem.set('That file is too big. Split it into files of up to 2 MB.');
      return;
    }
    const result = parseRedirectsCsv(await file.text());
    if (result.redirects.length > MAX_REDIRECT_IMPORT) {
      this.importProblem.set(`That file has ${result.redirects.length} redirects. Import up to ${MAX_REDIRECT_IMPORT} at a time.`);
      return;
    }
    this.parsed.set({ ...result, file: file.name });
    this.focus('redirects-import-preview');
  }

  protected async import(): Promise<void> {
    const parsed = this.parsed();
    if (!parsed?.redirects.length || this.busy()) return;
    this.busy.set(true);
    this.importProblem.set(null);
    try {
      const result = await firstValueFrom(this.api.importRedirects(this.spaceId(), { redirects: parsed.redirects }));
      const parts = [`${result.created} added`, `${result.updated} changed`];
      if (result.skipped.length) parts.push(`${result.skipped.length} left out, as published pages have those addresses: ${result.skipped.map((s) => s.fromPath).join(', ')}`);
      this.importResult.set(`Imported from ${parsed.file}: ${parts.join(', ')}.`);
      this.parsed.set(null);
      this.redirects.set(sorted(await firstValueFrom(this.api.listRedirects(this.spaceId()))));
      this.focus('redirects-import-result');
    } catch (error) {
      this.importProblem.set(problemMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected cancelImport(): void {
    this.parsed.set(null);
  }

  /** Downloads every redirect as a CSV file the import reads. */
  protected exportCsv(): void {
    const url = URL.createObjectURL(new Blob([redirectsCsv(this.redirects())], { type: 'text/csv;charset=utf-8' }));
    const link = this.document.createElement('a');
    link.href = url;
    link.download = 'redirects.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
  }

  private async load(spaceId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.redirects.set(sorted(await firstValueFrom(this.api.listRedirects(spaceId))));
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private focus(id: string): void {
    afterNextRender(() => this.document.getElementById(id)?.focus(), { injector: this.injector });
  }
}

function sorted(redirects: Redirect[]): Redirect[] {
  return [...redirects].sort((a, b) => a.fromPath.localeCompare(b.fromPath));
}
