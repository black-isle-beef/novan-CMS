import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent, DsBadgeComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import type { BlockType, ContentType } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { SchemaApi } from '../schema-api';

interface Model {
  contentTypes: ContentType[];
  blockTypes: BlockType[];
}

/** The content model of a space: its content types and block types. Developers and admins only. */
@Component({
  selector: 'nv-schema-page',
  imports: [DsAlertComponent, DsBadgeComponent, DsSpinnerComponent, RouterLink],
  templateUrl: './schema-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchemaPage {
  private readonly api = inject(SchemaApi);
  protected readonly context = inject(SpaceContext);

  /** Route parameter, and the name of a type just deleted (query parameter). */
  readonly spaceId = input.required<string>();
  readonly deleted = input<string>();

  protected readonly model = signal<Model | null>(null);
  protected readonly loadError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId);
      });
    });
  }

  private async load(spaceId: string): Promise<void> {
    this.model.set(null);
    this.loadError.set(null);
    try {
      const [contentTypes, blockTypes] = await Promise.all([
        firstValueFrom(this.api.listContentTypes(spaceId)),
        firstValueFrom(this.api.listBlockTypes(spaceId)),
      ]);
      this.model.set({ contentTypes, blockTypes });
    } catch (error) {
      this.loadError.set(problemMessage(error));
    }
  }
}
