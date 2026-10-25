// parts.ts — applies a block's class and token overrides (`_overrides`, docs/build/24-design-systems.md) to the
// elements a block marks as its parts. Classes are bound through Angular, so they are always set with `classList`,
// never written into markup, and they merge with the block's own classes instead of replacing them.
import { computed, Directive, HostAttributeToken, inject, InjectionToken } from '@angular/core';

import { NOVAN_BLOCK_CONTEXT } from './block-context';
import { type ClassAdapter, ROOT_PART } from './overrides';
import { NovanDesignSystems } from './site-styles';

/**
 * How the site writes breakpoints and states (`md:px-8`, `px-md-8`, ...). By default the adapter of the site's first
 * attached design system ({@link NovanDesignSystems}), else plain CSS, which has the base bucket only. Provide one to
 * use another.
 */
export const NOVAN_CLASS_ADAPTER = new InjectionToken<() => ClassAdapter>('NOVAN_CLASS_ADAPTER', {
  factory: () => {
    const designSystems = inject(NovanDesignSystems);
    return () => designSystems.adapter();
  },
});
import { type ClassAdapter, plainAdapter, ROOT_PART } from './overrides';

/**
 * How the site writes breakpoints and states (`md:px-8`, `px-md-8`, ...). Plain CSS, the default, has the base
 * bucket only; a site with a design system attached gets that design system's adapter.
 */
export const NOVAN_CLASS_ADAPTER = new InjectionToken<ClassAdapter>('NOVAN_CLASS_ADAPTER', { factory: () => plainAdapter });

/**
 * A block's part: an element in a block's template with `data-novan-part="<part>"`. Import it in the block
 * component; it adds the classes an editor gave that part. Outside `<novan-blocks>` it does nothing.
 */
@Directive({
  // The part marker itself is the selector, so a template names each part once.
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '[data-novan-part]',
  host: { '[class]': 'classes()' },
})
export class NovanPart {
  private readonly part = inject(new HostAttributeToken('data-novan-part'), { optional: true }) ?? '';
  private readonly context = inject(NOVAN_BLOCK_CONTEXT, { optional: true });

  protected readonly classes = computed(() => (this.part === ROOT_PART ? '' : (this.context?.parts?.()[this.part] ?? []).join(' ')));
}

/**
 * A block's root part, its host element: `hostDirectives: [NovanBlockRoot]` with `host: { 'data-novan-part': 'root' }`.
 * Adds the root's classes and sets the token overrides as custom properties on the block.
 */
@Directive({
  selector: '[novanBlockRoot]',
  host: { '[class]': 'classes()', '[style]': 'tokens()' },
})
export class NovanBlockRoot {
  private readonly context = inject(NOVAN_BLOCK_CONTEXT, { optional: true });

  protected readonly classes = computed(() => (this.context?.parts?.()[ROOT_PART] ?? []).join(' '));
  protected readonly tokens = computed(() => Object.fromEntries(this.context?.tokens?.() ?? []));
}
