// The Novan CLI (`@novan/cli`): content models and blocks as code, starter kits and seed content
// (docs/build/19-schema-cli-starter-kits.md, docs/clients/new-site.md).
import { Command, Option } from 'commander';
import { NovanApi, type Target } from './lib/api';
import { findManifest, planBlockSync, readManifest } from './lib/blocks';
import { findProject, readProfile, resolveApiUrl, resolveSchemaDir, resolveTarget, type TargetOptions, writeProfile, writeProject } from './lib/config';
import { diffSchemas, formatChanges } from './lib/diff';
import { CliError } from './lib/errors';
import { findKitsDir, kitNames, loadKit } from './lib/kits';
import { login } from './lib/login';
import { applyChanges } from './lib/push';
import { fromRemote, readSchemaDir, type SchemaSet, writeSchemaDir } from './lib/schema-files';
import { seed } from './lib/seed';
import { Credentials, keychain } from './lib/session';

declare const NOVAN_CLI_VERSION: string;

const cwd = process.cwd();
const cliDir = __dirname;
const log = (line = '') => console.log(line);
const project = () => findProject(cwd);

/** The API for these options, signed in as the profile (or the CI variables). */
function connect(options: TargetOptions): { api: NovanApi; credentials: Credentials } {
  const apiUrl = resolveApiUrl(options, project());
  // Each needs the other, and only calls it later.
  const api: NovanApi = new NovanApi(apiUrl, () => credentials.accessToken());
  const credentials = new Credentials(() => api);
  return { api, credentials };
}

function connectTo(options: TargetOptions): { api: NovanApi; target: Target } {
  const target = resolveTarget(options, project());
  return { api: connect(options).api, target };
}

async function remoteSchema(api: NovanApi, target: Target): Promise<SchemaSet> {
  const [contentTypes, blockTypes] = await Promise.all([api.contentTypes(target), api.blockTypes(target)]);
  return fromRemote(contentTypes, blockTypes);
}

/** The schema files to compare with: a kit's, or the site's (`--dir`, `novan.json`, `./novan/schema`). */
function localSchema(options: { dir?: string; kit?: string; kitsDir?: string }): { set: SchemaSet; from: string } {
  if (options.kit) {
    const kit = loadKit(findKitsDir(options.kitsDir, cwd, cliDir), options.kit);
    return { set: kit.schema, from: kit.schemaDir };
  }
  const dir = resolveSchemaDir(options.dir, project(), cwd);
  return { set: readSchemaDir(dir), from: dir };
}

const program = new Command('novan')
  .description('Novan CMS from the terminal: content models as code, blocks, starter kits.')
  .version(typeof NOVAN_CLI_VERSION === 'string' ? NOVAN_CLI_VERSION : '0.0.0-dev')
  .showHelpAfterError();

const apiOption = () => new Option('--api <url>', 'Novan API address (default: NOVAN_API_URL, novan.json, or where you signed in)');
const spaceOption = () => new Option('--space <id>', 'space id (default: NOVAN_SPACE or novan.json)');
const envOption = () => new Option('--env <name>', 'environment (default: NOVAN_ENVIRONMENT, novan.json, or main)');
const kitOptions = (command: Command) =>
  command.option('--kit <name>', "use a starter kit's schema instead of the site's").option('--kits-dir <dir>', 'where the starter kits are');

// --- Signing in -----------------------------------------------------------------------------------

program
  .command('login')
  .description('Sign in through the admin in your browser. Staff then confirm with their authenticator app.')
  .addOption(apiOption())
  .option('--no-browser', 'only print the address to open')
  .action(async (options: { api?: string; browser: boolean }) => {
    const apiUrl = resolveApiUrl(options, project());
    const api = new NovanApi(apiUrl, () => Promise.reject(new CliError('Not signed in yet.')));
    const email = await login(api, keychain(), { browser: options.browser, log });
    log(`Signed in to ${apiUrl} as ${email}.`);
  });

program
  .command('logout')
  .description('Forget the sign-in kept in the OS keychain.')
  .action(async () => {
    const profile = readProfile();
    if (!profile?.apiUrl) return log('You are not signed in.');
    await keychain().delete(profile.apiUrl);
    writeProfile(null);
    log(`Signed out of ${profile.apiUrl}.`);
  });

program
  .command('whoami')
  .description('Show who you are signed in as, and your spaces.')
  .addOption(apiOption())
  .action(async (options: TargetOptions) => {
    const { api } = connect(options);
    const me = await api.me();
    log(`${me.email ?? me.id} on ${api.apiUrl}${me.agencyStaff ? ' (agency staff)' : ''}`);
    for (const space of me.spaces) log(`  ${space.id}  ${space.role}`);
  });

// --- Spaces and tokens ----------------------------------------------------------------------------

const space = program.command('space').description('Client spaces.');

space
  .command('list')
  .description('List the spaces you can see.')
  .addOption(apiOption())
  .action(async (options: TargetOptions) => {
    const { api } = connect(options);
    for (const s of await api.spaces()) log(`${s.id}  ${s.slug.padEnd(24)} ${s.name}`);
  });

space
  .command('create')
  .description('Create a client space (agency staff). You become its first admin.')
  .addOption(apiOption())
  .requiredOption('--name <name>', "the client's or site's name")
  .requiredOption('--slug <slug>', 'short name for addresses, e.g. acme-ltd')
  .option('--organisation <id>', 'organisation id (default: your only one)')
  .option('--save', 'write the space to novan.json here, for later commands')
  .action(async (options: TargetOptions & { name: string; slug: string; organisation?: string; save?: boolean }) => {
    const { api } = connect(options);
    const created = await api.createSpace({ name: options.name, slug: options.slug, organisationId: options.organisation });
    log(`Created space ${created.name}: ${created.id}`);
    if (options.save) {
      const found = project();
      const file = writeProject(found?.dir ?? cwd, { ...found?.config, apiUrl: api.apiUrl, space: created.id });
      log(`Saved it to ${file}.`);
    }
  });

program
  .command('token')
  .description('API tokens for client sites.')
  .command('create')
  .description('Create a delivery or preview token. Its secret is shown once.')
  .addOption(apiOption())
  .addOption(spaceOption())
  .addOption(envOption())
  .requiredOption('--name <name>', 'what it is for, e.g. "Website"')
  .addOption(new Option('--scope <scope>', 'delivery (published content) or preview (drafts)').choices(['delivery', 'preview']).default('delivery'))
  .action(async (options: TargetOptions & { name: string; scope: 'delivery' | 'preview' }) => {
    const { api, target } = connectTo(options);
    const token = await api.createApiToken(target.spaceId, { name: options.name, scope: options.scope, environment: target.environment });
    log(token.token);
    console.error(`Created ${options.scope} token "${token.name}". Copy it now: it is not shown again.`);
  });

// --- Schema as code -------------------------------------------------------------------------------

const schema = program.command('schema').description('Content types and block types as JSON files.');

schema
  .command('pull')
  .description("Write the space's content types and block types to the schema directory.")
  .addOption(apiOption())
  .addOption(spaceOption())
  .addOption(envOption())
  .option('--dir <dir>', 'schema directory (default: novan.json, or ./novan/schema)')
  .action(async (options: TargetOptions & { dir?: string }) => {
    const { api, target } = connectTo(options);
    const dir = resolveSchemaDir(options.dir, project(), cwd);
    const files = writeSchemaDir(dir, await remoteSchema(api, target));
    log(`Wrote ${files.length} files to ${dir}.`);
  });

kitOptions(
  schema
    .command('diff')
    .description('Show what schema push would change in the space.')
    .addOption(apiOption())
    .addOption(spaceOption())
    .addOption(envOption())
    .option('--dir <dir>', 'schema directory (default: novan.json, or ./novan/schema)')
    .option('--exit-code', 'exit with 1 when there are differences (for CI)'),
).action(async (options: TargetOptions & { dir?: string; kit?: string; kitsDir?: string; exitCode?: boolean }) => {
  const { api, target } = connectTo(options);
  const local = localSchema(options);
  const changes = diffSchemas(local.set, await remoteSchema(api, target));
  if (!changes.length) return log(`The space matches ${local.from}.`);
  log(`Changes from ${local.from} to space ${target.spaceId} (${target.environment}):`);
  for (const line of formatChanges(changes)) log(line);
  if (options.exitCode) process.exitCode = 1;
});

kitOptions(
  schema
    .command('push')
    .description('Make the space match the schema files. Refuses destructive changes without --force.')
    .addOption(apiOption())
    .addOption(spaceOption())
    .addOption(envOption())
    .option('--dir <dir>', 'schema directory (default: novan.json, or ./novan/schema)')
    .option('--dry-run', 'show the changes without making them')
    .option('--force', 'also delete types, remove fields and change field types'),
).action(async (options: TargetOptions & { dir?: string; kit?: string; kitsDir?: string; dryRun?: boolean; force?: boolean }) => {
  const { api, target } = connectTo(options);
  const local = localSchema(options);
  const remote = await remoteSchema(api, target);
  const changes = diffSchemas(local.set, remote);
  if (!changes.length) return log(`The space already matches ${local.from}.`);
  for (const line of formatChanges(changes)) log(line);
  log();
  await applyChanges(api, target, local.set, remote, changes, { force: Boolean(options.force), dryRun: Boolean(options.dryRun), log });
  if (!options.dryRun) log(`The space now matches ${local.from}.`);
});

// --- Blocks ---------------------------------------------------------------------------------------

program
  .command('blocks')
  .description('Block types from @novan/blocks.')
  .command('sync')
  .description("Bring the space's block types in line with @novan/blocks: name, fields, style options, icon, preview image.")
  .argument('[blocks...]', 'blocks to create or update (default: every block the space already has)')
  .addOption(apiOption())
  .addOption(spaceOption())
  .addOption(envOption())
  .option('--manifest <file>', "the blocks' block-types.json (default: from @novan/blocks)")
  .option('--dry-run', 'show the changes without making them')
  .option('--force', 'also remove fields and change field types')
  .action(async (names: string[], options: TargetOptions & { manifest?: string; dryRun?: boolean; force?: boolean }) => {
    const { api, target } = connectTo(options);
    const manifestFile = findManifest(options.manifest, cwd, cliDir);
    const remote = await remoteSchema(api, target);
    const plan = planBlockSync(readManifest(manifestFile), remote, names);
    if (plan.skipped.length) log(`Not in this space (name them to add them): ${plan.skipped.join(', ')}`);
    if (!plan.changes.length) return log(`Block types already match ${manifestFile}.`);
    for (const line of formatChanges(plan.changes)) log(line);
    log();
    await applyChanges(api, target, plan.local, remote, plan.changes, { force: Boolean(options.force), dryRun: Boolean(options.dryRun), log });
  });

// --- Starter kits ---------------------------------------------------------------------------------

program
  .command('kits')
  .description('List the starter kits.')
  .option('--kits-dir <dir>', 'where the starter kits are')
  .action((options: { kitsDir?: string }) => {
    const dir = findKitsDir(options.kitsDir, cwd, cliDir);
    for (const name of kitNames(dir)) log(`${name.padEnd(12)} ${loadKit(dir, name).description}`);
  });

program
  .command('seed')
  .description("Create and publish a starter kit's pages. Run schema push --kit first.")
  .requiredOption('--kit <name>', 'brochure, blog or portfolio')
  .option('--kits-dir <dir>', 'where the starter kits are')
  .addOption(apiOption())
  .addOption(spaceOption())
  .addOption(envOption())
  .option('--no-publish', 'leave the pages as drafts')
  .action(async (options: TargetOptions & { kit: string; kitsDir?: string; publish: boolean }) => {
    const { api, target } = connectTo(options);
    const kit = loadKit(findKitsDir(options.kitsDir, cwd, cliDir), options.kit);
    const result = await seed(api, target, kit.seed, { publish: options.publish, message: `Seeded from the ${kit.name} kit`, log });
    log(`Seeded ${result.created} entries (${result.published} published, ${result.skipped} already there).`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(`novan: ${error.message}`);
    process.exitCode = error.exitCode;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
