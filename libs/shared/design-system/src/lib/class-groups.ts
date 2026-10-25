// class-groups.ts — sorts a design system's classes into groups for the editor's class browser and autocomplete
// (docs/build/24-design-systems.md): the manifest's own `classGroups` first, then a preset for utility frameworks.

/** Groups, by class prefix. A prefix ending in `-` matches classes starting with it; otherwise the exact class. */
type GroupPreset = readonly (readonly [group: string, prefixes: readonly string[]])[];

const COLOUR_WORDS = /-(primary|secondary|success|danger|warning|info|light|dark|body|muted|white|black|emphasis|reset)(-|$)/;

/** Bootstrap 5 and Tailwind-style utility names; good enough for grouping, never for validating. */
const UTILITY_GROUPS: GroupPreset = [
  ['spacing', ['m-', 'mt-', 'mb-', 'ms-', 'me-', 'mx-', 'my-', 'p-', 'pt-', 'pb-', 'ps-', 'pe-', 'px-', 'py-', 'gap-', 'row-gap-', 'column-gap-', 'space-x-', 'space-y-', 'ml-', 'mr-', 'pl-', 'pr-']],
  ['display', ['d-', 'block', 'inline', 'inline-block', 'hidden', 'visible', 'invisible', 'visually-hidden', 'contents']],
  ['flex', ['flex', 'flex-', 'justify-', 'justify-content-', 'align-', 'align-items-', 'align-self-', 'align-content-', 'items-', 'self-', 'content-', 'order-', 'grow', 'grow-', 'shrink', 'shrink-', 'basis-']],
  ['grid', ['container', 'container-', 'row', 'row-cols-', 'col', 'col-', 'offset-', 'g-', 'gx-', 'gy-', 'grid', 'grid-', 'place-']],
  ['sizing', ['w-', 'h-', 'mw-', 'mh-', 'vw-', 'vh-', 'min-w-', 'min-h-', 'max-w-', 'max-h-', 'size-']],
  ['position', ['position-', 'static', 'relative', 'absolute', 'fixed', 'sticky', 'top-', 'bottom-', 'start-', 'end-', 'inset-', 'left-', 'right-', 'translate-', 'z-', 'float-', 'clearfix']],
  ['borders', ['border', 'border-', 'rounded', 'rounded-', 'outline', 'outline-', 'ring', 'ring-', 'divide-']],
  ['shadow', ['shadow', 'shadow-', 'opacity-']],
  ['typography', ['text-', 'fs-', 'fw-', 'fst-', 'lh-', 'font-', 'lead', 'display-', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'small', 'mark', 'tracking-', 'leading-', 'uppercase', 'lowercase', 'capitalize', 'italic', 'underline', 'truncate']],
  ['colour', ['bg-', 'text-bg-', 'link-', 'from-', 'via-', 'to-', 'fill-', 'stroke-', 'accent-']],
  ['buttons', ['btn', 'btn-']],
  ['forms', ['form-', 'input-group', 'input-group-', 'was-validated', 'is-valid', 'is-invalid', 'valid-', 'invalid-']],
  ['components', ['card', 'card-', 'navbar', 'navbar-', 'nav', 'nav-', 'alert', 'alert-', 'badge', 'modal', 'modal-', 'dropdown', 'dropdown-', 'list-group', 'list-group-', 'breadcrumb', 'pagination', 'page-', 'accordion', 'accordion-', 'carousel', 'carousel-', 'table', 'table-', 'toast', 'tooltip', 'popover', 'progress', 'spinner-', 'offcanvas', 'offcanvas-', 'placeholder']],
];

function matches(className: string, prefix: string): boolean {
  return prefix.endsWith('-') ? className.startsWith(prefix) : className === prefix;
}

/**
 * The class's group: the first manifest group with a matching prefix, else the utility preset (for Bootstrap,
 * Tailwind and plain CSS alike), else null. `text-primary` is a colour; `text-center` is typography.
 */
export function classGroupOf(className: string, manifestGroups?: Readonly<Record<string, readonly string[]>> | null): string | null {
  for (const [group, prefixes] of Object.entries(manifestGroups ?? {})) {
    if (prefixes.some((prefix) => matches(className, prefix))) return group;
  }
  // Strip responsive and state prefixes (`md:px-4`, `hover:bg-x`) before matching the preset.
  const bare = className.slice(className.lastIndexOf(':') + 1).replace(/^!/, '');
  if ((bare.startsWith('text-') || bare.startsWith('border-')) && COLOUR_WORDS.test(bare)) return 'colour';
  for (const [group, prefixes] of UTILITY_GROUPS) {
    if (prefixes.some((prefix) => matches(bare, prefix))) return group;
  }
  return null;
}
