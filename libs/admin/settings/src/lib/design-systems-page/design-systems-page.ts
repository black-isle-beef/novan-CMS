import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DsAlertComponent, DsBadgeComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { type HasUnsavedChanges, warnBeforeUnload } from '@novan/admin-shell';
import { DesignSystemsApi, problemFieldErrors, problemMessage, SpaceContext } from '@novan/admin-spaces';
import { designSystemFrameworks, type DesignSystemFramework } from '@novan/shared-design-system';
import type { DesignSystem, DesignSystemClasses, DesignSystemVersion, DesignSystemVersionStatus, SiteDesignSystem } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';

/** The frameworks, in the words the screen uses. */
export const frameworkLabels: Readonly<Record<DesignSystemFramework, string>> = {
  css: 'Plain CSS',
  bootstrap: 'Bootstrap',
  tailwind: 'Tailwind',
  'web-components': 'Web components',
};

const statusLabels: Readonly<Record<DesignSystemVersionStatus, { label: string; variant: 'info' | 'success' | 'danger' | 'secondary' }>> = {
  uploaded: { label: 'Waiting for the file', variant: 'info' },
  validating: { label: 'Checking', variant: 'info' },
  invalid: { label: 'Has problems', variant: 'danger' },
  ready: { label: 'Ready', variant: 'success' },
  deprecated: { label: 'Deprecated', variant: 'secondary' },
};

/** How often, and how many times, a version being checked is asked about. */
const POLL_MS = 1500;
const POLL_TRIES = 40;

/** A site entry while it is being changed: the saved one plus the switch and position. */
interface SiteItem {
  versionId: string;
  name: string;
  version: string;
  framework: DesignSystemFramework;
  status: DesignSystemVersionStatus;
  enabled: boolean;
}

/**
 * The space's design systems (docs/build/24-design-systems.md): which ones the site loads and in what order, each
 * design system's versions with what checking them found, a new version from a stylesheet or an address, and a
 * browser of each version's classes. For admins and developers, once agency staff turn the feature on.
 */
@Component({
  selector: 'nv-design-systems-page',
  imports: [DatePipe, DsAlertComponent, DsBadgeComponent, DsSpinnerComponent, ReactiveFormsModule],
  templateUrl: './design-systems-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesignSystemsPage implements HasUnsavedChanges {
  private readonly api = inject(DesignSystemsApi);
  private readonly forms = inject(NonNullableFormBuilder);
  protected readonly context = inject(SpaceContext);

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly frameworks = designSystemFrameworks;
  protected readonly frameworkLabels = frameworkLabels;
  protected readonly enabled = computed(() => this.context.currentSpace()?.designSystems === true);

  protected readonly systems = signal<DesignSystem[] | null>(null);
  protected readonly site = signal<SiteItem[]>([]);
  private readonly savedSite = signal<SiteItem[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Polite announcements: saved, moved, checked. */
  protected readonly status = signal('');
  protected readonly busy = signal(false);

  protected readonly siteDirty = computed(() => JSON.stringify(this.site().map(siteKey)) !== JSON.stringify(this.savedSite().map(siteKey)));
  /** Ready versions not on the site, one per design system not on it. */
  protected readonly attachable = computed(() => {
    const onSite = new Set(this.site().map((item) => this.systemOf(item.versionId)?.id));
    return (this.systems() ?? [])
      .filter((system) => !onSite.has(system.id))
      .flatMap((system) => system.versions.filter((version) => version.status === 'ready').map((version) => ({ system, version })));
  });

  protected readonly createForm = this.forms.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    slug: ['', [Validators.required, Validators.maxLength(40), Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)]],
    framework: ['bootstrap' as DesignSystemFramework, Validators.required],
  });
  protected readonly createSubmitted = signal(false);
  protected readonly createErrors = signal<Record<string, string[]>>({});

  protected readonly versionForm = this.forms.group({
    designSystemId: ['', Validators.required],
    version: ['1.0.0', [Validators.required, Validators.pattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/)]],
    source: ['css' as 'css' | 'url'],
    url: [''],
  });
  protected readonly versionSubmitted = signal(false);
  protected readonly versionErrors = signal<Record<string, string[]>>({});
  protected readonly file = signal<File | null>(null);
  protected readonly attachChoice = signal('');

  /** The version whose classes are shown, and what was found. */
  protected readonly browsing = signal<{ system: DesignSystem; version: DesignSystemVersion } | null>(null);
  protected readonly classes = signal<DesignSystemClasses | null>(null);
  protected readonly classQuery = signal('');
  protected readonly classGroup = signal<string | undefined>(undefined);

  private destroyed = false;
  /** How long to wait between asking about a version being checked. */
  protected pollMs = POLL_MS;

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => this.context.currentSpaceId.set(spaceId));
    });
    // Nothing to load until the agency turns design systems on (the API would refuse most of it).
    effect(() => {
      const spaceId = this.spaceId();
      if (this.enabled()) untracked(() => void this.load(spaceId));
    });
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.siteDirty() && !this.busy();
  }

  protected statusOf(status: DesignSystemVersionStatus) {
    return statusLabels[status];
  }

  protected suggestSlug(): void {
    const slug = this.createForm.controls.slug;
    if (slug.dirty) return;
    slug.setValue(
      this.createForm.controls.name.value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40),
    );
  }

  protected createInvalid(name: 'name' | 'slug'): boolean {
    return (this.createSubmitted() && this.createForm.controls[name].invalid) || !!this.createErrors()[name];
  }

  protected versionInvalid(name: 'designSystemId' | 'version' | 'url' | 'file'): boolean {
    if (this.versionErrors()[name] || this.versionErrors()[name === 'file' ? 'filename' : name]) return true;
    if (!this.versionSubmitted()) return false;
    if (name === 'file') return this.versionForm.controls.source.value === 'css' && !this.file();
    if (name === 'url') return this.versionForm.controls.source.value === 'url' && !/^https:\/\/\S+$/i.test(this.versionForm.controls.url.value);
    return this.versionForm.controls[name].invalid;
  }

  protected fieldError(errors: Record<string, string[]>, name: string): string | null {
    return errors[name]?.[0] ?? null;
  }

  protected chooseFile(event: Event): void {
    this.file.set((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  protected async create(): Promise<void> {
    this.createSubmitted.set(true);
    this.createErrors.set({});
    this.error.set(null);
    if (this.createForm.invalid || this.busy()) return;
    const { name, slug, framework } = this.createForm.getRawValue();
    this.busy.set(true);
    try {
      const system = await firstValueFrom(this.api.create(this.spaceId(), { name: name.trim(), slug, framework }));
      this.systems.update((list) => [...(list ?? []), system].sort((a, b) => a.name.localeCompare(b.name)));
      this.createForm.reset({ name: '', slug: '', framework: 'bootstrap' });
      this.createSubmitted.set(false);
      this.versionForm.controls.designSystemId.setValue(system.id);
      this.status.set(`${system.name} added. Upload its first version below.`);
    } catch (error) {
      this.error.set(problemMessage(error));
      this.createErrors.set(problemFieldErrors(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** Starts a version: uploads the file (or gives the address), then waits for the check. */
  protected async addVersion(): Promise<void> {
    this.versionSubmitted.set(true);
    this.versionErrors.set({});
    this.error.set(null);
    const { designSystemId, version, source, url } = this.versionForm.getRawValue();
    const file = this.file();
    if (this.versionInvalid('designSystemId') || this.versionInvalid('version') || this.versionInvalid('file') || this.versionInvalid('url')) return;
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const body = source === 'css' ? { source, version, filename: safeFilename(file?.name ?? 'styles.css') } : { source, version, url: url.trim() };
      const started = await firstValueFrom(this.api.createVersion(this.spaceId(), designSystemId, body));
      let current = started.version;
      if (started.uploadUrl && file) {
        this.status.set(`Uploading ${file.name}…`);
        await this.api.upload(started.uploadUrl, file);
        current = await firstValueFrom(this.api.complete(this.spaceId(), designSystemId, current.id));
      }
      this.putVersion(current);
      this.versionForm.patchValue({ url: '' });
      this.file.set(null);
      this.versionSubmitted.set(false);
      this.status.set(`Checking version ${current.version}…`);
      void this.watch(designSystemId, current.id);
    } catch (error) {
      this.error.set(problemMessage(error));
      this.versionErrors.set(problemFieldErrors(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async deprecate(system: DesignSystem, version: DesignSystemVersion): Promise<void> {
    this.error.set(null);
    try {
      this.putVersion(await firstValueFrom(this.api.deprecate(this.spaceId(), system.id, version.id)));
      this.status.set(`${system.name} ${version.version} is deprecated. It stays on the site until you replace it.`);
    } catch (error) {
      this.error.set(problemMessage(error));
    }
  }

  protected attach(): void {
    const choice = this.attachable().find((option) => option.version.id === this.attachChoice());
    if (!choice) return;
    this.site.update((list) => [...list, toItem(choice.system, choice.version)]);
    this.attachChoice.set('');
    this.status.set(`${choice.system.name} ${choice.version.version} added to the list. Save to load it on the site.`);
  }

  protected move(index: number, by: -1 | 1): void {
    const list = [...this.site()];
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.site.set(list);
    this.status.set(`${list[target].name} moved to position ${target + 1} of ${list.length}.`);
  }

  protected toggle(index: number, event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.site.update((list) => list.map((item, i) => (i === index ? { ...item, enabled } : item)));
  }

  protected detach(index: number): void {
    const item = this.site()[index];
    this.site.update((list) => list.filter((_, i) => i !== index));
    this.status.set(`${item.name} removed from the list. Save to stop loading it.`);
  }

  protected async saveSite(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.putSite(this.spaceId(), this.site().map((item) => ({ versionId: item.versionId, enabled: item.enabled }))),
      );
      this.setSite(saved);
      this.status.set('Saved. The site loads these design systems from its next page view.');
    } catch (error) {
      this.error.set(problemMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected revertSite(): void {
    this.site.set(this.savedSite());
  }

  protected async browse(system: DesignSystem, version: DesignSystemVersion): Promise<void> {
    this.browsing.set({ system, version });
    this.classQuery.set('');
    this.classGroup.set(undefined);
    await this.searchClasses();
  }

  protected async searchClasses(): Promise<void> {
    const browsing = this.browsing();
    if (!browsing) return;
    try {
      this.classes.set(
        await firstValueFrom(
          this.api.classes(this.spaceId(), browsing.system.id, browsing.version.id, {
            q: this.classQuery().trim() || undefined,
            group: this.classGroup(),
            limit: 100,
          }),
        ),
      );
    } catch (error) {
      this.error.set(problemMessage(error));
    }
  }

  protected setClassQuery(event: Event): void {
    this.classQuery.set((event.target as HTMLInputElement).value);
    void this.searchClasses();
  }

  protected setClassGroup(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.classGroup.set(value === '*' ? undefined : value);
    void this.searchClasses();
  }

  private systemOf(versionId: string): DesignSystem | undefined {
    return (this.systems() ?? []).find((system) => system.versions.some((version) => version.id === versionId));
  }

  private putVersion(version: DesignSystemVersion): void {
    this.systems.update((list) =>
      (list ?? []).map((system) =>
        system.id !== version.designSystemId
          ? system
          : { ...system, versions: [version, ...system.versions.filter((candidate) => candidate.id !== version.id)] },
      ),
    );
  }

  /** Asks about a version being checked until it is ready or has problems, then says which. */
  private async watch(designSystemId: string, versionId: string): Promise<void> {
    for (let tries = 0; tries < POLL_TRIES && !this.destroyed; tries++) {
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      if (this.destroyed) return;
      try {
        const version = await firstValueFrom(this.api.version(this.spaceId(), designSystemId, versionId));
        if (version.status === 'validating' || version.status === 'uploaded') continue;
        this.putVersion(version);
        const warnings = version.report?.warnings.length ?? 0;
        this.status.set(
          version.status === 'ready'
            ? `Version ${version.version} is ready${warnings ? `, with ${warnings} thing${warnings === 1 ? '' : 's'} to look at` : ''}.`
            : `Version ${version.version} has problems. See what was found below.`,
        );
        return;
      } catch {
        // Try again: the check goes on in the background.
      }
    }
  }

  private async load(spaceId: string): Promise<void> {
    this.systems.set(null);
    this.loadError.set(null);
    try {
      const [systems, site] = await Promise.all([firstValueFrom(this.api.list(spaceId)), firstValueFrom(this.api.site(spaceId))]);
      this.systems.set(systems);
      this.setSite(site);
      if (systems.length && !this.versionForm.controls.designSystemId.value) this.versionForm.controls.designSystemId.setValue(systems[0].id);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    }
  }

  private setSite(site: SiteDesignSystem[]): void {
    const items = site.map((item) => ({
      versionId: item.versionId,
      name: item.name,
      version: item.version,
      framework: item.framework,
      status: item.status,
      enabled: item.enabled,
    }));
    this.site.set(items);
    this.savedSite.set(items);
  }
}

function toItem(system: DesignSystem, version: DesignSystemVersion): SiteItem {
  return { versionId: version.id, name: system.name, version: version.version, framework: system.framework, status: version.status, enabled: true };
}

function siteKey(item: SiteItem): string {
  return `${item.versionId}:${item.enabled}`;
}

/** The name the API stores the stylesheet under: letters, numbers, dots, hyphens and underscores, ending .css. */
export function safeFilename(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 140) || 'styles';
  return /\.css$/i.test(base) ? base : `${base}.css`;
}
