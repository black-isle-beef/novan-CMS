// cms-style-panel/cms-style-panel.component.ts — the editor UI: a form generated from a block's style options,
// plus a live preview of the block. Styles: src/styles/_style-panel.scss.
import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

import type { AnyCmsComponentDefinition } from '../cms-registry';
import { type CmsStoredSettings, defaultsOf, fieldViews, resolveSettings } from '../cms-schema';

let nextId = 0;

@Component({
  selector: 'novan-style-panel',
  imports: [NgComponentOutlet],
  templateUrl: './cms-style-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'novan-style-panel' },
})
export class CmsStylePanelComponent {
  readonly definition = input.required<AnyCmsComponentDefinition>();
  /** Field values shown in the preview. Falls back to the definition's sample content. */
  readonly content = input<object | null | undefined>(undefined);
  /** Two-way bound style options: `[(settings)]="block._style"`. Always written back complete and valid. */
  readonly settings = model<CmsStoredSettings | null>(null);
  /** Hides the preview when the host page already renders the block. */
  readonly showPreview = input(true);

  protected readonly uid = `novan-style-panel-${nextId++}`;

  protected readonly fields = computed(() => fieldViews(this.definition().settingsSchema));
  protected readonly resolved = computed(
    () => resolveSettings(this.definition().settingsSchema, this.settings()) as Record<string, unknown>,
  );
  protected readonly previewInputs = computed(() => ({
    ...(this.content() ?? this.definition().sampleContent),
    settings: this.resolved(),
  }));

  protected controlId(key: string, suffix?: string): string {
    return suffix ? `${this.uid}-${key}-${suffix}` : `${this.uid}-${key}`;
  }

  protected hintId(key: string): string {
    return `${this.uid}-${key}-hint`;
  }

  protected update(key: string, value: string | boolean): void {
    this.settings.set({ ...this.resolved(), [key]: value });
  }

  protected onSelect(key: string, event: Event): void {
    this.update(key, (event.target as HTMLSelectElement).value);
  }

  protected onToggle(key: string, event: Event): void {
    this.update(key, (event.target as HTMLInputElement).checked);
  }

  protected reset(): void {
    this.settings.set(defaultsOf(this.definition().settingsSchema) as CmsStoredSettings);
  }
}
