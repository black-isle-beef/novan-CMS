import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // Migrations are one-off scripts that sign in, upload and seed exactly as the Novan CLI does, so they reuse its
    // source (tools/novan-cli/src/lib) rather than copy it. The CLI is an application, not a library, so there is no
    // import path to use instead; if a second tool needs it, move that code to a library under libs/.
    files: ['**/*.ts'],
    rules: { '@nx/enforce-module-boundaries': 'off' },
  },
];
