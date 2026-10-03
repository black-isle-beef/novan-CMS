import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';

type LinkType = 'internal' | 'external' | 'email';

interface LinkValue {
  type: LinkType;
  entryId?: string;
  anchor?: string;
  url?: string;
  email?: string;
  text?: string;
}

const typeLabels: Record<LinkType, string> = {
  internal: 'A page on this site',
  external: 'A web address',
  email: 'An email address',
};

/** A link to a page on the site, a web address or an email address, with the text people click. */
@Component({
  selector: 'nv-link-field',
  imports: [FieldMessages],
  templateUrl: './link-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkField extends FieldControl<FieldDefOf<'link'>> {
  protected readonly link = computed<LinkValue | null>(() => {
    const value = this.value();
    return typeof value === 'object' && value !== null && 'type' in value ? (value as LinkValue) : null;
  });

  protected readonly types = computed(() => {
    const field = this.field();
    const types: LinkType[] = ['internal', ...(field.allowExternal ? ['external' as const] : []), ...(field.allowEmail ? ['email' as const] : [])];
    return types.map((type) => ({ type, label: typeLabels[type] }));
  });

  protected readonly pages = computed(() => this.context.entries());

  protected errorsAt(key: string): string[] {
    return this.context.errors()[`${this.path()}.${key}`] ?? [];
  }

  protected setType(event: Event): void {
    const type = (event.target as HTMLSelectElement).value as LinkType | '';
    if (!type) {
      this.value.set(null);
      return;
    }
    // Keep the link text when switching between kinds of link.
    const text = this.link()?.text;
    this.value.set({ type, ...(text ? { text } : {}) });
  }

  protected setPart(key: keyof Omit<LinkValue, 'type'>, event: Event): void {
    const link = this.link();
    if (!link) return;
    const text = (event.target as HTMLInputElement | HTMLSelectElement).value;
    const next: LinkValue = { ...link };
    if (text) next[key] = key === 'url' || key === 'email' ? text.trim() : text;
    else delete next[key];
    this.value.set(next);
  }
}
