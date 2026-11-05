// Builds the site for production, with or without the Novan design system and Bootstrap: the choice made in the admin
// (Schema > Set up from GitHub) comes from Delivery `site-styles` (docs/clients/new-site.md). `npx nx run
// starter-site:build-site`, and the Dockerfile's build step.
//
//   NOVAN_STYLES=include|omit   decides without asking the API
//   NOVAN_API_URL               with a delivery token, asks the API
//   NOVAN_DELIVERY_TOKEN        or, in Docker, the secret file below, so that no image layer holds the token
//
// With neither, the design system stays in: a shared image knows no space. When a space should be asked and the answer
// cannot be had, the build fails, rather than quietly shipping the framework a client opted out of.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TOKEN_FILE = '/run/secrets/novan_delivery_token';

/** Asks Delivery whether the space's site takes the design system. An API too old to say means it does. */
export async function novanStylesFromApi(apiUrl, token, fetchFn = fetch) {
  const url = `${apiUrl.replace(/\/+$/, '')}/v1/delivery/site-styles`;
  const response = await fetchFn(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body = await response.json();
  return body.novanStyles !== false;
}

/** The token from the environment, or from Docker's secret mount. */
export function deliveryToken(env, readFile = () => (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8') : '')) {
  return (env.NOVAN_DELIVERY_TOKEN || readFile()).trim();
}

/** The Nx configuration to build, and why, for the build's log. */
export async function chooseConfiguration(env, { token = deliveryToken(env), fetchFn = fetch } = {}) {
  const explicit = env.NOVAN_STYLES?.trim();
  if (explicit && explicit !== 'include' && explicit !== 'omit') {
    throw new Error(`NOVAN_STYLES must be "include" or "omit", not "${explicit}".`);
  }
  let include;
  let reason;
  if (explicit) {
    include = explicit === 'include';
    reason = 'NOVAN_STYLES';
  } else if (env.NOVAN_API_URL && token) {
    include = await novanStylesFromApi(env.NOVAN_API_URL, token, fetchFn);
    reason = "the space's setting";
  } else {
    include = true;
    reason = 'the default: no NOVAN_STYLES, and no API address and token to ask';
  }
  return { configuration: include ? 'production' : 'production-plain', reason };
}

async function main() {
  const { configuration, reason } = await chooseConfiguration(process.env);
  console.log(`Building ${configuration} (from ${reason}).`);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // Shell only on Windows, where a .cmd needs one; the arguments are fixed above.
  const build = spawnSync(npx, ['nx', 'build', 'starter-site', `--configuration=${configuration}`], { stdio: 'inherit', shell: process.platform === 'win32' });
  process.exit(build.status ?? 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`Could not choose the site's build: ${error.message}`);
    process.exit(1);
  });
}
