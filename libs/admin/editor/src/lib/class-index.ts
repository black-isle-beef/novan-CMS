import { computed, inject, Injectable, signal } from '@angular/core';
import { DesignSystemsApi } from '@novan/admin-spaces';
import { adapterFor, type ClassAdapter } from '@novan/shared-design-system';
import type { DesignSystemClass, SiteDesignSystem } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';

const SUGGESTIONS = 20;

/** A class an editor might mean, and which design system has it. */
export interface ClassSuggestion extends DesignSystemClass {
  source: string;
}

/**
 * The classes of the design systems the space's site loads (docs/build/24-design-systems.md), for the block
 * panel's Classes section: suggestions as editors type, whether a class exists, and the site's class adapter (how
 * breakpoints and states are written). Provide it in the editor page; answers are kept for the page's life.
 */
@Injectable()
export class EditorClassIndex {
  private readonly api = inject(DesignSystemsApi);
  private spaceId: string | null = null;
  private readonly site = signal<SiteDesignSystem[]>([]);
  private readonly answers = new Map<string, Promise<ClassSuggestion[]>>();

  /** Enabled versions, first loaded first. */
  protected readonly loaded = computed(() => this.site().filter((item) => item.enabled));
  /** The site's adapter: its first design system's, else plain CSS. */
  readonly adapter = computed<ClassAdapter>(() => {
    const first = this.loaded()[0];
    return adapterFor(first ? { framework: first.framework, breakpoints: first.breakpoints ?? undefined, states: first.states ?? undefined } : null);
  });
  /** "Acme 1.2.0 and Icons 3.0.0", for "not found in …"; null without design systems. */
  readonly label = computed(() => {
    const names = this.loaded().map((item) => `${item.name} ${item.version}`);
    return names.length ? names.join(' and ') : null;
  });

  /** Reads what the site loads; a space without design systems (or an older API) just has none. */
  async load(spaceId: string, enabled: boolean): Promise<void> {
    this.spaceId = spaceId;
    this.answers.clear();
    if (!enabled) {
      this.site.set([]);
      return;
    }
    try {
      this.site.set(await firstValueFrom(this.api.site(spaceId)));
    } catch {
      this.site.set([]);
    }
  }

  /** Classes starting with `q` in every loaded design system, shortest first. */
  suggest(q: string): Promise<ClassSuggestion[]> {
    const query = q.trim();
    if (!query || !this.spaceId || !this.loaded().length) return Promise.resolve([]);
    const cached = this.answers.get(query);
    if (cached) return cached;
    const spaceId = this.spaceId;
    const answer = Promise.all(
      this.loaded().map(async (item) => {
        try {
          const found = await firstValueFrom(this.api.classes(spaceId, item.designSystemId, item.versionId, { q: query, limit: SUGGESTIONS }));
          return found.items.map((entry) => ({ ...entry, source: item.name }));
        } catch {
          return [];
        }
      }),
    ).then((lists) => {
      const seen = new Set<string>();
      return lists
        .flat()
        .filter((entry) => !seen.has(entry.name) && seen.add(entry.name))
        .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
        .slice(0, SUGGESTIONS);
    });
    this.answers.set(query, answer);
    return answer;
  }

  /** Whether a loaded design system defines the class; null when there are none to ask. */
  async exists(name: string): Promise<boolean | null> {
    if (!this.loaded().length) return null;
    return (await this.suggest(name)).some((entry) => entry.name === name);
  }
}
