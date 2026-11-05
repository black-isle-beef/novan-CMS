// A site that opted out really has no Novan design system or Bootstrap in it (docs/clients/new-site.md). Runs on the
// plain build: `npx nx run starter-site:test-plain-bundle`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const dist = resolve(import.meta.dirname, '../../../dist/apps/starter-site');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(js|mjs|css)$/.test(name) ? [{ path, text: readFileSync(path, 'utf8') }] : [];
  });
}

const browser = files(join(dist, 'browser'));
const server = files(join(dist, 'server'));
const css = browser.filter((file) => file.path.endsWith('.css')).map((file) => file.text).join('\n');

test('the build has a stylesheet, with the blocks in it', () => {
  assert.match(css, /novan-hero-block/, 'no block styles; run the plain build first');
  assert.match(css, /site-chrome__header/);
});

test('no Bootstrap or design-system CSS', () => {
  // Bootstrap's own marks, and rules this build has no stand-in for.
  for (const mark of ['--bs-body-bg', '--bs-primary', '.navbar', '.dropdown-menu', '.ds-header', '.ds-footer', '.ds-main-nav', 'bootstrap-icons', 'Montserrat Alternates']) {
    assert.ok(!css.includes(mark), `the stylesheet has ${mark}`);
  }
});

test('no design-system components in the JavaScript', () => {
  for (const file of [...browser, ...server]) {
    assert.ok(!file.text.includes('ds-header__banner'), `${file.path} has the design-system header`);
    assert.ok(!file.text.includes('ds-footer__region'), `${file.path} has the design-system footer`);
  }
});

test('every custom property the block styles use is declared at :root', () => {
  const stylesDir = resolve(import.meta.dirname, '../../../libs/blocks/src/styles');
  const used = new Set(readdirSync(stylesDir).flatMap((name) => [...readFileSync(join(stylesDir, name), 'utf8').matchAll(/var\((--(?:ds|bs)-[a-z0-9-]*)\)/g)].map((m) => m[1])));
  const root = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes(':root'))
    .flatMap(([, , body]) => [...body.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !root.includes(name));
  assert.deepEqual(missing, [], `undeclared custom properties: ${missing.join(', ')}`);
});
