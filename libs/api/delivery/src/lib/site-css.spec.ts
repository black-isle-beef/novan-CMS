import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blockCssOf, buildSiteCss, CUSTOM_HTML_SCOPE, SiteCss, siteCssTags } from './site-css';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const block = (n: number, css: unknown, extra: object = {}) => ({ _uid: uid(n), _block: 'customHtml', html: '<p>Hi</p>', css, ...extra });

describe('the site stylesheet of custom HTML blocks', () => {
  it('scopes to the attribute the block puts on its host', () => {
    // The block is an Angular library; read its constant rather than import across the API boundary.
    const source = readFileSync(resolve(import.meta.dirname, '../../../../blocks/src/lib/components/custom-html/custom-html.css.ts'), 'utf8');
    expect(source).toContain(`export const CUSTOM_HTML_SCOPE = '${CUSTOM_HTML_SCOPE}';`);
  });

  describe('finding the blocks', () => {
    it('finds them in fields, groups and children, in page order', () => {
      const data = {
        title: 'Home',
        body: [
          block(1, 'h2 { color: red }'),
          { _uid: uid(2), _block: 'columns', children: [block(3, '.a { margin: 0 }')] },
          { _uid: uid(4), _block: 'hero', heading: 'Not this' },
        ],
        sidebar: { panels: [block(5, 'p { color: blue }')] },
      };
      expect(blockCssOf(data)).toEqual([
        { uid: uid(1), css: 'h2 { color: red }' },
        { uid: uid(3), css: '.a { margin: 0 }' },
        { uid: uid(5), css: 'p { color: blue }' },
      ]);
    });

    it('leaves out hidden blocks and what is inside them, and blocks without CSS', () => {
      const data = {
        body: [
          block(1, 'h2 { color: red }', { _hidden: true }),
          { _uid: uid(2), _block: 'columns', _hidden: true, children: [block(3, '.a { margin: 0 }')] },
          block(4, '  '),
          block(5, null),
          block(6, { 'en-GB': '.a {}' }),
        ],
      };
      expect(blockCssOf(data)).toEqual([]);
    });

    it.each([null, 'text', 42, [[null]]])('is safe on %j', (data) => {
      expect(blockCssOf(data)).toEqual([]);
    });
  });

  describe('building it', () => {
    it('puts each block in its scope, in the overrides layer, after the layer order', () => {
      expect(buildSiteCss([{ uid: uid(1), css: 'h2 { color: red }' }, { uid: uid(2), css: '& { padding: 1rem }' }])).toBe(
        [
          '@layer novan-base, ds-vendor, ds-components, novan-overrides;',
          `@layer novan-overrides {\n[data-novan-custom-html="${uid(1)}"] {\nh2 { color: red }\n}\n}`,
          `@layer novan-overrides {\n[data-novan-custom-html="${uid(2)}"] {\n& { padding: 1rem }\n}\n}`,
          '',
        ].join('\n'),
      );
    });

    it('cleans the CSS as uploads are cleaned', () => {
      const css = buildSiteCss([{ uid: uid(1), css: '@import url(https://evil.example/x.css); .a { behavior: url(x.htc); color: red }' }]);
      expect(css).not.toMatch(/import|behavior|evil/);
      expect(css).toContain('.a { color: red }');
    });

    it('never lets a rule escape its block', () => {
      expect(buildSiteCss([{ uid: uid(1), css: '} body { display: none } .a {' }])).toBe('');
      expect(buildSiteCss([{ uid: 'x"] body, [x="', css: 'h2 { color: red }' }])).toBe('');
    });

    it('keeps the first CSS of a _uid seen twice, and is empty with nothing to add', () => {
      const css = buildSiteCss([
        { uid: uid(1), css: '.first {}' },
        { uid: uid(1), css: '.second {}' },
      ]);
      expect(css).toContain('.first');
      expect(css).not.toContain('.second');
      expect(buildSiteCss([])).toBe('');
      expect(buildSiteCss([{ uid: uid(1), css: '/* nothing */' }])).toBe('');
    });

    it('is tagged to be purged by any publish in the environment', () => {
      expect(siteCssTags('space-1', 'env-1')).toEqual(['space:space-1', 'entries:env-1', 'site-styles:env-1']);
    });

    it('has a fingerprint that follows its content', () => {
      expect(SiteCss.version('a')).toMatch(/^[0-9a-f]{12}$/);
      expect(SiteCss.version('a')).not.toBe(SiteCss.version('b'));
    });
  });
});
