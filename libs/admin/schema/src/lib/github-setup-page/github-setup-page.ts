import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DsAlertComponent, DsBadgeComponent, DsToastService } from '@black-isle-beef/novan-design-system';
import { problemFieldErrors, problemMessage, SpaceContext } from '@novan/admin-spaces';
import { applyChanges, type Change, describe, diffSchemas, fromRemote, SchemaSyncError } from '@novan/schema-sync';
import { type GithubSchemaSource, githubRepoUrlSchema } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { SchemaApi } from '../schema-api';
import { schemaWriter } from './schema-writer';

/** What a check found: the repo's schema at one commit, and what it takes to make the space match it. */
interface Plan {
  source: GithubSchemaSource;
  changes: Change[];
  destructive: number;
}

const actionLabel = { create: 'Add', update: 'Change', delete: 'Delete' } as const;

function githubAddress(control: AbstractControl<string>): ValidationErrors | null {
  return !control.value.trim() || githubRepoUrlSchema.safeParse(control.value).success ? null : { githubAddress: true };
}

/**
 * Sets up a new site's content model, or restores a space's, from the schema files in a GitHub repo
 * (`novan schema pull` writes them; docs/clients/new-site.md). The API reads the repo with its own GitHub token,
 * so private repos work; the changes are then pushed from here as the signed-in person, exactly as `novan schema
 * push` would. Agency staff only.
 */
@Component({
  selector: 'nv-github-setup-page',
  imports: [DsAlertComponent, DsBadgeComponent, ReactiveFormsModule, RouterLink],
  templateUrl: './github-setup-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GithubSetupPage {
  private readonly api = inject(SchemaApi);
  private readonly toasts = inject(DsToastService);
  protected readonly context = inject(SpaceContext);
  protected readonly actionLabel = actionLabel;
  protected readonly describe = describe;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    repoUrl: ['', [Validators.required, githubAddress]],
    ref: ['', [Validators.maxLength(200)]],
    path: ['novan/schema', [Validators.required, Validators.maxLength(200)]],
  });
  protected readonly confirm = this.fb.group({
    restore: [false],
    slug: [''],
  });
  private readonly confirmValue = toSignal(this.confirm.valueChanges, { initialValue: this.confirm.getRawValue() });

  protected readonly submitted = signal(false);
  protected readonly checking = signal(false);
  protected readonly checkError = signal<string | null>(null);
  protected readonly serverErrors = signal<Record<string, string[]>>({});
  protected readonly plan = signal<Plan | null>(null);

  protected readonly applying = signal(false);
  protected readonly log = signal<string[]>([]);
  protected readonly applyError = signal<string | null>(null);
  /** The commit the space was made to match. */
  protected readonly applied = signal<string | null>(null);

  protected readonly slug = computed(() => this.context.currentSpace()?.slug ?? '');
  protected readonly restore = computed(() => this.confirmValue().restore === true);
  /** Destructive changes need Restore; Restore needs the space's short name typed. */
  protected readonly canApply = computed(() => {
    const plan = this.plan();
    if (!plan?.changes.length || this.applying() || this.applied()) return false;
    if (plan.destructive && !this.restore()) return false;
    return !this.restore() || (this.confirmValue().slug ?? '').trim() === this.slug();
  });

  private readonly results = viewChild<ElementRef<HTMLElement>>('results');
  private readonly outcome = viewChild<ElementRef<HTMLElement>>('outcome');

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        this.reset();
      });
    });
  }

  protected invalid(name: 'repoUrl' | 'ref' | 'path'): boolean {
    return (this.submitted() && this.form.controls[name].invalid) || !!this.serverErrors()[name];
  }

  protected async check(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid || this.checking() || this.applying()) return;
    this.reset();
    this.checking.set(true);
    const { repoUrl, ref, path } = this.form.getRawValue();
    const spaceId = this.spaceId();
    try {
      const [source, contentTypes, blockTypes] = await Promise.all([
        firstValueFrom(this.api.readGithubSchema(spaceId, { repoUrl: repoUrl.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}), path: path.trim() })),
        firstValueFrom(this.api.listContentTypes(spaceId)),
        firstValueFrom(this.api.listBlockTypes(spaceId)),
      ]);
      const changes = diffSchemas(source, fromRemote(contentTypes, blockTypes));
      this.plan.set({ source, changes, destructive: changes.filter((change) => change.destructive).length });
      this.submitted.set(false);
      this.focus(this.results);
    } catch (error) {
      this.checkError.set(problemMessage(error));
      this.serverErrors.set(problemFieldErrors(error));
    } finally {
      this.checking.set(false);
    }
  }

  protected async apply(): Promise<void> {
    const plan = this.plan();
    if (!plan || !this.canApply()) return;
    const spaceId = this.spaceId();
    const force = this.restore();
    this.applying.set(true);
    this.applyError.set(null);
    this.log.set([]);
    try {
      // The space as it is now, in case it changed since the check.
      const [contentTypes, blockTypes] = await Promise.all([firstValueFrom(this.api.listContentTypes(spaceId)), firstValueFrom(this.api.listBlockTypes(spaceId))]);
      const remote = fromRemote(contentTypes, blockTypes);
      await applyChanges(schemaWriter(this.api), spaceId, plan.source, remote, diffSchemas(plan.source, remote), {
        force,
        dryRun: false,
        log: (line) => this.log.update((lines) => [...lines, line]),
        forceHint: 'Choose Restore',
      });
      this.applied.set(plan.source.commitSha);
      this.toasts.success(`The schema now matches ${plan.source.repo} at ${plan.source.commitSha.slice(0, 7)}.`);
    } catch (error) {
      this.applyError.set(error instanceof SchemaSyncError ? error.message : problemMessage(error));
    } finally {
      this.applying.set(false);
      this.focus(this.outcome);
    }
  }

  private reset(): void {
    this.plan.set(null);
    this.checkError.set(null);
    this.serverErrors.set({});
    this.applyError.set(null);
    this.applied.set(null);
    this.log.set([]);
    this.confirm.reset({ restore: false, slug: '' });
  }

  /** Moves focus to a region once it has rendered, so screen readers announce the result. */
  private focus(target: () => ElementRef<HTMLElement> | undefined): void {
    setTimeout(() => target()?.nativeElement.focus());
  }
}
