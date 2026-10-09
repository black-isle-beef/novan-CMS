import { computed, inject, Injectable, signal } from '@angular/core';
import type { ManagedLocales } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { ManagementApi } from './management-api';

/**
 * The locales of the space being worked in (docs/build/16-localisation.md), loaded once per space and kept up to
 * date by the Locales settings screen. Editors use them to switch between translations.
 */
@Injectable({ providedIn: 'root' })
export class SpaceLocales {
  private readonly api = inject(ManagementApi);
  private readonly loaded = signal<{ spaceId: string; value: ManagedLocales } | null>(null);
  private pending: { spaceId: string; value: Promise<ManagedLocales> } | null = null;

  /** The current space's locales, once loaded. */
  readonly value = computed(() => this.loaded()?.value ?? null);
  readonly locales = computed(() => this.value()?.locales ?? []);
  readonly multilingual = computed(() => this.locales().length > 1);

  /** The space's locales, from the API the first time they are asked for. */
  load(spaceId: string): Promise<ManagedLocales> {
    const loaded = this.loaded();
    if (loaded?.spaceId === spaceId) return Promise.resolve(loaded.value);
    if (this.pending?.spaceId === spaceId) return this.pending.value;
    const value = firstValueFrom(this.api.listLocales(spaceId)).then(
      (locales) => {
        this.set(spaceId, locales);
        return locales;
      },
      (error: unknown) => {
        this.pending = null;
        throw error;
      },
    );
    this.pending = { spaceId, value };
    return value;
  }

  /** Records the space's locales after a change. */
  set(spaceId: string, value: ManagedLocales): void {
    this.pending = null;
    this.loaded.set({ spaceId, value });
  }
}
