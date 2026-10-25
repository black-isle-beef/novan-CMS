import { processStylesheet, type StylesheetOptions } from './css-processor';

const upload: StylesheetOptions = { file: 'acme.css', allowedOrigins: [], baseUrl: null };
const fromCdn: StylesheetOptions = { file: 'bootstrap.min.css', allowedOrigins: [], baseUrl: 'https://cdn.example.com/npm/bootstrap@5/dist/css/bootstrap.min.css' };
const process = (css: string, options: Partial<StylesheetOptions> = {}) => processStylesheet(css, { ...upload, ...options });
const messages = (issues: { message: string }[]) => issues.map((issue) => issue.message);

describe('processing a stylesheet', () => {
  it('puts it in the vendor layer, after the layer order', () => {
    const { css, errors } = process('.btn { color: red }');
    expect(errors).toEqual([]);
    expect(css).toBe('@layer novan-base, ds-vendor, ds-components, novan-overrides;\n@layer ds-vendor {\n.btn { color: red }\n}');
    expect(process('.x{}', { layer: 'ds-components' }).css).toContain('@layer ds-components {');
  });

  it('lists the classes its selectors use, unescaped, outside keyframes', () => {
    const { classes } = process(`
      .btn, .btn-primary:hover > .icon { color: red }
      .md\\:px-8 { padding: 2rem }
      @media (min-width: 40rem) { .col-md-6 { width: 50% } }
      @keyframes spin { from { opacity: 0 } to { opacity: 1 } }
      .btn { margin: 0 }
    `);
    expect(classes).toEqual(['btn', 'btn-primary', 'icon', 'md:px-8', 'col-md-6']);
  });

  it('reports a stylesheet it cannot read, with the line', () => {
    const { errors, css } = process('.a { color: red }\n.b { color: blue');
    expect(errors).toEqual([{ file: 'acme.css', line: 2, message: 'The stylesheet cannot be read: Unclosed block.' }]);
    expect(css).toBe('');
  });

  it('refuses a stylesheet with no rules', () => {
    expect(messages(process('/* nothing */').errors)).toEqual(['The stylesheet has no rules.']);
  });

  it('removes what runs code in old browsers', () => {
    const { css, warnings } = process('.a { behavior: url(x.htc); color: red } .b { width: expression(alert(1)) } .c { -moz-binding: url(x.xml#b) }');
    expect(css).not.toMatch(/behavior|expression|binding/);
    expect(css).toContain('color: red');
    expect(warnings.map((warning) => warning.line)).toEqual([1, 1, 1]);
  });

  it.each([
    ['javascript: URLs', '.a { background: url("javascript:alert(1)") }', 'it links to javascript: addresses.'],
    ['vbscript: URLs', '.a { background: url(vbscript:msgbox) }', 'it links to vbscript: addresses.'],
    ['HTML in data: URLs', '.a { background: url("data:text/html,<script>alert(1)</script>") }', 'it embeds a data: URL that is not an image or a font.'],
    ['http addresses', '.a { background: url(http://cdn.example.com/a.png) }', 'http://cdn.example.com/a.png is not an https address.'],
    ['files in an uploaded stylesheet', '.a { background: url(img/a.png) }', 'img/a.png is a file inside the package; upload a zip with the stylesheet and its files.'],
  ])('removes declarations with %s', (_, css, problem) => {
    const result = process(css);
    expect(result.css).not.toContain('background');
    expect(messages(result.warnings)).toEqual([`background was removed: ${problem}`]);
  });

  it('keeps image and font data: URLs and fragments', () => {
    const { css, warnings } = process(
      '.a { background: url("data:image/svg+xml,%3csvg%3e") } @font-face { src: url(data:font/woff2;base64,AAAA) } .b { filter: url(#blur) }',
    );
    expect(css).toContain('data:image/svg+xml');
    expect(css).toContain('data:font/woff2');
    expect(css).toContain('url(#blur)');
    expect(warnings).toEqual([]);
  });

  it("resolves a CDN stylesheet's files against its address, and says where they load from", () => {
    const { css, warnings } = process('@font-face { src: url("../fonts/icons.woff2") format("woff2") }', fromCdn);
    expect(css).toContain('url("https://cdn.example.com/npm/bootstrap@5/dist/fonts/icons.woff2") format("woff2")');
    expect(messages(warnings)).toEqual(['It loads files from https://cdn.example.com; visitors\' browsers fetch them from there.']);
  });

  it('keeps imports from allowed origins, in the layer, before everything else', () => {
    const { css, warnings } = process(
      '@charset "utf-8"; @import url("https://fonts.googleapis.com/css2?family=Inter") screen; @import "https://evil.example/x.css"; @import "local.css"; .a { color: red }',
      { allowedOrigins: ['https://fonts.googleapis.com'] },
    );
    expect(css.split('\n').slice(0, 2)).toEqual([
      '@layer novan-base, ds-vendor, ds-components, novan-overrides;',
      '@import url("https://fonts.googleapis.com/css2?family=Inter") layer(ds-vendor) screen;',
    ]);
    expect(css).not.toMatch(/evil|local\.css|@charset/);
    expect(messages(warnings)).toEqual([
      '@import "https://evil.example/x.css" was removed: only imports from the design system\'s allowed origins are kept.',
      '@import "local.css" was removed: only imports from the design system\'s allowed origins are kept.',
    ]);
  });

  it('warns about !important, which beats editors\' classes', () => {
    expect(messages(process('.a { color: red !important } .b { margin: 0 !important }').warnings)).toEqual([
      '2 declarations use !important, which beats the classes editors add to blocks.',
    ]);
  });

  it('cannot be broken out of its layer', () => {
    const { css } = process('} .evil { color: red } @layer x {', {});
    expect(css === '' || css.indexOf('.evil') > css.indexOf('@layer ds-vendor {')).toBe(true);
  });
});
