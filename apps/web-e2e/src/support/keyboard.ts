/**
 * Why Tab-to-link checks skip WebKit: like Safari with its default "Press Tab to highlight each item" setting off,
 * Playwright's WebKit moves Tab between form controls only, so no link (the skip link included) is reached.
 */
export const WEBKIT_TAB_SKIPS_LINKS = 'WebKit skips links on Tab, as Safari does by default';
