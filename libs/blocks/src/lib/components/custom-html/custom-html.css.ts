// components/custom-html/custom-html.css.ts — a custom HTML block's own CSS, scoped to the block. Published pages get it
// from the site's stylesheet (`GET /v1/site-css`, libs/api/delivery/src/lib/site-css.ts), which wraps each block's
// CSS the same way; in preview the block adds it to the page itself, so the editor sees unsaved changes.

/** The attribute on the block's host that its CSS is scoped to: `[data-novan-custom-html="<_uid>"]`. */
export const CUSTOM_HTML_SCOPE = 'data-novan-custom-html';

/** Marks the `<style>` a block adds in preview, by `_uid`, so it is found again after hydration. */
export const CUSTOM_HTML_PREVIEW_STYLE = 'data-novan-custom-css';

/** A `_uid` that can go in an attribute selector as it is. */
const SAFE_UID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The block's CSS nested in its scope, in the `novan-overrides` layer: `h2 { ... }` styles the block's headings and
 * `& { ... }` the block itself. Null when there is nothing to add, the `_uid` is unusable, or the braces do not
 * balance (which would let rules escape the scope). `</` is escaped so the text cannot close a `<style>` element.
 */
export function scopedCustomCss(uid: string | null | undefined, css: string | null | undefined): string | null {
  if (typeof uid !== 'string' || !SAFE_UID.test(uid) || typeof css !== 'string' || css.trim() === '') return null;
  if (!balanced(css)) return null;
  return `@layer novan-overrides {\n[${CUSTOM_HTML_SCOPE}="${uid}"] {\n${css.trim().replace(/<\//g, '<\\/')}\n}\n}`;
}

/** Whether every `{` has its `}`, outside comments and strings. */
function balanced(css: string): boolean {
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) return false;
      i = end + 1;
    } else if (char === '"' || char === "'") {
      i++;
      while (i < css.length && css[i] !== char) {
        if (css[i] === '\\') i++;
        else if (css[i] === '\n') return false;
        i++;
      }
      if (i >= css.length) return false;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      if (--depth < 0) return false;
    }
  }
  return depth === 0;
}
