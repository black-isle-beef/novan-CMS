import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DsAlertComponent, DsBadgeComponent, DsOffcanvasComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { problemMessage } from '@novan/admin-spaces';
import type { BlockType, ContentType, Entry, EntryVersion } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { describeChange } from '../change-text';
import { ContentApi } from '../content-api';

interface Comparison {
  version: EntryVersion;
  changes: string[] | null;
  error: string | null;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The version history drawer: every saved version, newest first, with what changed since each one
 * and (for people who can edit) a way to make it the current version again.
 */
@Component({
  selector: 'nv-version-history',
  imports: [DsAlertComponent, DsBadgeComponent, DsOffcanvasComponent, DsSpinnerComponent],
  templateUrl: './version-history.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VersionHistory {
  private readonly api = inject(ContentApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly open = model(false);
  readonly spaceId = input.required<string>();
  readonly entry = input.required<Entry>();
  readonly contentType = input.required<ContentType>();
  readonly blockTypes = input<BlockType[]>([]);
  readonly canRestore = input(false);
  /** Unsaved changes are lost when a version is restored, so the confirmation says so. */
  readonly hasUnsavedChanges = input(false);
  readonly restored = output<Entry>();

  protected readonly versions = signal<EntryVersion[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly comparison = signal<Comparison | null>(null);
  protected readonly confirming = signal<EntryVersion | null>(null);
  protected readonly restoreError = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.open()) untracked(() => void this.load());
    });
  }

  protected time(version: EntryVersion): string {
    return when.format(new Date(version.createdAt));
  }

  protected async compare(version: EntryVersion): Promise<void> {
    this.confirming.set(null);
    this.comparison.set({ version, changes: null, error: null });
    try {
      const diff = await firstValueFrom(this.api.diff(this.spaceId(), version.id, this.entry().currentVersionId));
      const fields = this.contentType().fields;
      this.comparison.set({ version, changes: diff.changes.map((change) => describeChange(change, fields, this.blockTypes())), error: null });
    } catch (error) {
      this.comparison.set({ version, changes: null, error: problemMessage(error) });
    }
    this.focus('version-comparison');
  }

  protected askRestore(version: EntryVersion): void {
    this.comparison.set(null);
    this.restoreError.set(null);
    this.confirming.set(version);
    this.focus('version-restore-confirm');
  }

  protected async restore(): Promise<void> {
    const version = this.confirming();
    if (!version) return;
    try {
      const entry = await firstValueFrom(this.api.restoreVersion(this.spaceId(), this.entry().id, version.id));
      this.confirming.set(null);
      this.open.set(false);
      this.restored.emit(entry);
    } catch (error) {
      this.restoreError.set(problemMessage(error));
    }
  }

  private async load(): Promise<void> {
    this.versions.set(null);
    this.loadError.set(null);
    this.comparison.set(null);
    this.confirming.set(null);
    try {
      this.versions.set(await firstValueFrom(this.api.listVersions(this.spaceId(), this.entry().id)));
    } catch (error) {
      this.loadError.set(problemMessage(error));
    }
  }

  private focus(elementId: string): void {
    afterNextRender(() => this.host.nativeElement.ownerDocument.getElementById(elementId)?.focus(), {
      injector: this.injector,
    });
  }
}
