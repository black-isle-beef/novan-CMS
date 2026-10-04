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

test('no token, token variable or token-shaped value is in the browser bundle', () => {
  const values = tokenEnv.map((name) => process.env[name]).filter((value) => value && value.length >= 8);
  for (const file of browser) {
    for (const name of tokenEnv) assert.ok(!file.text.includes(name), `${file.path} mentions ${name}`);
    for (const value of values) assert.ok(!file.text.includes(value), `${file.path} contains a token from the environment`);
    assert.doesNotMatch(file.text, tokenShape, `${file.path} contains something shaped like an API token`);
  }
});
