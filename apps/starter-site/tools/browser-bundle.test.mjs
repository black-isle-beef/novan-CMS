// The browser bundle must never contain a Novan API token (docs/build/09-angular-sdk.md, Definition of done).
// Runs on the production build: `npx nx run starter-site:test-bundle`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const dist = resolve(import.meta.dirname, '../../../dist/apps/starter-site');

/** Every text file under a folder, with its contents. */
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(js|mjs|html|css|json|txt|map)$/.test(name) ? [{ path, text: readFileSync(path, 'utf8') }] : [];
  });
}

const browser = files(join(dist, 'browser'));
const server = files(join(dist, 'server'));

const tokenEnv = ['NOVAN_DELIVERY_TOKEN', 'NOVAN_PREVIEW_TOKEN'];
/** Anything shaped like a real token: the prefix and at least 16 more characters. */
const tokenShape = /nv_(del|pre)_[A-Za-z0-9_-]{16,}/;

test('the build has a browser and a server bundle', () => {
  assert.ok(browser.some((file) => file.path.endsWith('.js')), 'no browser JavaScript; run the production build first');
  assert.ok(server.length > 0, 'no server bundle');
});

test('the server reads the tokens from its environment', () => {
  // Shows the check below looks for what the server really uses.
  for (const name of tokenEnv) {
    assert.ok(server.some((file) => file.text.includes(name)), `${name} is not read by the server bundle`);
  }
});

// An undefined custom property fails silently (the declaration is dropped), so check the blocks' styles use
// only properties the built stylesheet declares (docs/build/10-blocks-starter-site.md).
test('every custom property the block styles use is declared in the built stylesheet', () => {
  const css = browser.filter((file) => file.path.endsWith('.css')).map((file) => file.text).join('\n');
  const stylesDir = resolve(import.meta.dirname, '../../../libs/blocks/src/styles');
  const used = new Set(
    readdirSync(stylesDir).flatMap((name) => [...readFileSync(join(stylesDir, name), 'utf8').matchAll(/var\((--[a-z][a-z0-9-]*)\)/g)].map((m) => m[1])),
  );
  // Design-system and Bootstrap properties must be global (`:root`): the design system also declares some
  // inside showcase classes such as `.ds-lf`, which blocks cannot rely on. A block's own properties are
  // declared on the block. Interpolated names (`--#{$block}-surface`) do not match the pattern above.
  const declaredIn = (scope) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => scope(selector))
      .flatMap(([, , body]) => [...body.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)].map((m) => m[1]));
  const global = new Set(declaredIn((selector) => selector.includes(':root')));
  const anywhere = new Set(declaredIn(() => true));
  const missing = [...used].filter((name) => !(name.startsWith('--novan-') ? anywhere : global).has(name));
  assert.deepEqual(missing, [], `undeclared custom properties: ${missing.join(', ')}`);
});

test('no token, token variable or token-shaped value is in the browser bundle', () => {
  const values = tokenEnv.map((name) => process.env[name]).filter((value) => value && value.length >= 8);
  for (const file of browser) {
    for (const name of tokenEnv) assert.ok(!file.text.includes(name), `${file.path} mentions ${name}`);
    for (const value of values) assert.ok(!file.text.includes(value), `${file.path} contains a token from the environment`);
    assert.doesNotMatch(file.text, tokenShape, `${file.path} contains something shaped like an API token`);
  }
});
