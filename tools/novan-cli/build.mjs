// Bundles the CLI into dist/tools/novan-cli: one CommonJS file (workspace libraries inlined, npm dependencies left
// to package.json), the starter kits, the blocks manifest and the package manifest, ready for `npm publish`.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(root, 'dist/tools/novan-cli');
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(here, 'src/main.ts')],
  outfile: join(out, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  tsconfig: join(here, 'tsconfig.app.json'),
  external: Object.keys(pkg.dependencies),
  banner: { js: '#!/usr/bin/env node' },
  define: { NOVAN_CLI_VERSION: JSON.stringify(pkg.version) },
  sourcemap: true,
  logLevel: 'warning',
});

cpSync(join(root, 'kits'), join(out, 'kits'), { recursive: true });
cpSync(join(root, 'libs/blocks/block-types.json'), join(out, 'block-types.json'));
cpSync(join(here, 'README.md'), join(out, 'README.md'));
writeFileSync(join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log(`Built ${pkg.name}@${pkg.version} in ${out}`);