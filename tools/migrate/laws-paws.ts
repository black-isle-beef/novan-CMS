// laws-paws.ts — moves the old Law's Paws site's content into its Novan space through the Management API (never SQL):
// uploads the brand files and stock photos, then creates and publishes the pages, menu, footer and site settings.
// Safe to run again: files already in the library and pages whose address exists are kept, never duplicated or
// overwritten, so it only adds what is missing. Run it after `novan schema push` in apps/laws-paws-site.
//
//   git clone https://github.com/black-isle-beef/laws-paws ../laws-paws
//   npx tsx --tsconfig tools/migrate/tsconfig.json tools/migrate/laws-paws.ts --source ../laws-paws --dry-run
//   npx tsx --tsconfig tools/migrate/tsconfig.json tools/migrate/laws-paws.ts --source ../laws-paws
//
// It signs in as `novan login` did (or NOVAN_EMAIL and NOVAN_PASSWORD / NOVAN_ACCESS_TOKEN), and works on the space in
// apps/laws-paws-site/novan.json unless --api, --space or --env (or NOVAN_API_URL, NOVAN_SPACE) say otherwise.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { NovanApi } from '../novan-cli/src/lib/api';
import { findProject, resolveApiUrl, resolveTarget } from '../novan-cli/src/lib/config';
import { CliError } from '../novan-cli/src/lib/errors';
import { seed } from '../novan-cli/src/lib/seed';
import { Credentials } from '../novan-cli/src/lib/session';
import { LAWS_PAWS_ENTRIES, LAWS_PAWS_MEDIA, withAssets } from './laws-paws.content';
import { syncMedia } from './media';

/** Block types the pages use beyond the brochure kit's. */
const PILOT_BLOCKS = ['mediaText', 'cardGrid', 'badgeList'];
const MESSAGE = "Migrated from the old Law's Paws site";

const log = (line = '') => console.log(line);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      api: { type: 'string' },
      space: { type: 'string' },
      env: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'no-publish': { type: 'boolean', default: false },
    },
  });
  if (!values.source) throw new CliError('Pass --source <folder>: a checkout of github.com/black-isle-beef/laws-paws.');
  const sourceDir = resolve(values.source, 'public');
  if (!existsSync(join(sourceDir, 'images')))
    throw new CliError(`${sourceDir} has no images folder. Is --source the old site's repository?`);

  const siteDir = resolve('apps/laws-paws-site');
  if (!existsSync(siteDir)) throw new CliError('Run this from the root of the novan-CMS repository.');
  const project = findProject(siteDir);
  const options = { api: values.api, space: values.space, env: values.env };
  const target = resolveTarget(options, project);
  const api: NovanApi = new NovanApi(resolveApiUrl(options, project), () => credentials.accessToken());
  const credentials = new Credentials(() => api);
  log(
    `Migrating Law's Paws into space ${target.spaceId} (${target.environment}) on ${api.apiUrl}${values['dry-run'] ? ', dry run' : ''}.`,
  );

  const blockTypes = new Set((await api.blockTypes(target)).map((type) => type.apiId));
  const missing = PILOT_BLOCKS.filter((apiId) => !blockTypes.has(apiId));
  if (missing.length)
    throw new CliError(
      `The space has no ${missing.join(', ')} block type. Run novan schema push in apps/laws-paws-site first.`,
    );

  const ids = await syncMedia(api, target.spaceId, LAWS_PAWS_MEDIA, { sourceDir, dryRun: values['dry-run'], log });
  const entries = withAssets(LAWS_PAWS_ENTRIES, ids);
  if (values['dry-run']) {
    for (const entry of entries) log(`Would create ${entry.contentType} "${entry.slug}" unless it exists.`);
    return;
  }
  const result = await seed(api, target, { entries }, { publish: !values['no-publish'], message: MESSAGE, log });
  log(`Done: ${result.created} entries created (${result.published} published), ${result.skipped} already there.`);
  log('Next: set the form recipients and site address in the admin (docs/clients/laws-paws-launch.md).');
}

main().catch((error: unknown) => {
  console.error(error instanceof CliError ? `migrate: ${error.message}` : error);
  process.exitCode = 1;
});
