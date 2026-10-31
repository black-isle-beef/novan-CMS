// components/custom-html/custom-html.css.spec.ts
import { CUSTOM_HTML_SCOPE, scopedCustomCss } from './custom-html.css';

const UID = '00000000-0000-4000-8000-000000000001';

describe('scopedCustomCss', () => {
  it('nests the CSS in the block scope, in the overrides layer', () => {
    expect(scopedCustomCss(UID, '  h2 { color: red; }\n')).toBe(
      `@layer novan-overrides {\n[data-novan-custom-html="${UID}"] {\nh2 { color: red; }\n}\n}`,
    );
    expect(CUSTOM_HTML_SCOPE).toBe('data-novan-custom-html');
  });

  it('keeps braces in strings and comments out of the count', () => {
    expect(scopedCustomCss(UID, `.a::before { content: "}"; } /* { */ .b { content: '{'; }`)).not.toBeNull();
  });

  it.each([
    ['a brace that closes the scope', '} body { display: none; } .a {'],
    ['an unclosed rule', '.a { color: red;'],
    ['an unclosed comment', '.a { color: red; } /* {'],
    ['an unclosed string', '.a { content: "x; }'],
  ])('refuses %s', (_label, css) => {
    expect(scopedCustomCss(UID, css)).toBeNull();
  });

  it('escapes </ so the text cannot close a style element', () => {
    expect(scopedCustomCss(UID, '.a::after { content: "</style><script>"; }')).toContain('"<\\/style><script>"');
  });

  it.each([
    ['no CSS', UID, null],
    ['blank CSS', UID, '  \n '],
    ['no uid', null, 'h2 { color: red; }'],
    ['a uid that could leave the selector', 'x"] body, [x="', 'h2 { color: red; }'],
  ])('gives nothing for %s', (_label, uid, css) => {
    expect(scopedCustomCss(uid, css)).toBeNull();
  });
});
