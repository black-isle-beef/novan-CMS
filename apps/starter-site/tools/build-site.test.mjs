// Which build a site gets. No build runs here: `npx nx run starter-site:test-build-site`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseConfiguration, deliveryToken, novanStylesFromApi } from './build-site.mjs';

const answering = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });
const refusing = () => assert.fail('the API should not be asked');

test('with nothing to go on, the design system stays in', async () => {
  const { configuration } = await chooseConfiguration({}, { token: '', fetchFn: refusing });
  assert.equal(configuration, 'production');
});

test('an API address without a token does not ask', async () => {
  const { configuration } = await chooseConfiguration({ NOVAN_API_URL: 'https://api.example' }, { token: '', fetchFn: refusing });
  assert.equal(configuration, 'production');
});

test("the space's opt-out builds the plain configuration", async () => {
  const env = { NOVAN_API_URL: 'https://api.example' };
  const { configuration } = await chooseConfiguration(env, { token: 'nv_del_x', fetchFn: answering({ novanStyles: false }) });
  assert.equal(configuration, 'production-plain');
});

test('a space that did not opt out builds as before', async () => {
  const env = { NOVAN_API_URL: 'https://api.example' };
  const { configuration } = await chooseConfiguration(env, { token: 'nv_del_x', fetchFn: answering({ novanStyles: true }) });
  assert.equal(configuration, 'production');
});

test('NOVAN_STYLES wins, without asking the API', async () => {
  const env = { NOVAN_STYLES: 'omit', NOVAN_API_URL: 'https://api.example' };
  const { configuration } = await chooseConfiguration(env, { token: 'nv_del_x', fetchFn: refusing });
  assert.equal(configuration, 'production-plain');
});

test('NOVAN_STYLES refuses anything else', async () => {
  await assert.rejects(chooseConfiguration({ NOVAN_STYLES: 'false' }, { token: '' }), /must be "include" or "omit"/);
});

test('a space that cannot be asked fails the build rather than shipping the design system', async () => {
  const env = { NOVAN_API_URL: 'https://api.example' };
  await assert.rejects(chooseConfiguration(env, { token: 'nv_del_x', fetchFn: answering({}, 503) }), /answered 503/);
});

test('an API that does not know the setting means the design system stays in', async () => {
  assert.equal(await novanStylesFromApi('https://api.example/', 'nv_del_x', answering({ layers: '' })), true);
});

test('asks Delivery with the token', async () => {
  let seen;
  await novanStylesFromApi('https://api.example/', 'nv_del_x', async (url, init) => {
    seen = { url, authorization: init.headers.Authorization };
    return { ok: true, status: 200, json: async () => ({ novanStyles: true }) };
  });
  assert.deepEqual(seen, { url: 'https://api.example/v1/delivery/site-styles', authorization: 'Bearer nv_del_x' });
});

test('the token comes from the environment, else the secret file, trimmed', () => {
  assert.equal(deliveryToken({ NOVAN_DELIVERY_TOKEN: 'from-env' }, () => assert.fail('no need to read the file')), 'from-env');
  assert.equal(deliveryToken({}, () => 'from-secret\n'), 'from-secret');
});
