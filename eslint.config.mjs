import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          // Every project carries one scope:* and one type:* tag; a project must satisfy
          // every constraint whose sourceTag it has. See docs/build/00-conventions.md.
          depConstraints: [
            // Scopes: the API is server-only; admin and sites never import it.
            { sourceTag: 'scope:api', onlyDependOnLibsWithTags: ['scope:api', 'scope:shared'] },
            { sourceTag: 'scope:admin', onlyDependOnLibsWithTags: ['scope:admin', 'scope:shared'] },
            { sourceTag: 'scope:site', onlyDependOnLibsWithTags: ['scope:site', 'scope:shared'] },
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
            // Published packages (@black-isle-beef/cms-angular) may only pull in shared code.
            { sourceTag: 'publishable', onlyDependOnLibsWithTags: ['scope:shared'] },
            // Layers: apps > feature > ui > data > util.
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:feature', 'type:ui', 'type:data', 'type:util'] },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: ['type:feature', 'type:ui', 'type:data', 'type:util'],
            },
            { sourceTag: 'type:ui', onlyDependOnLibsWithTags: ['type:ui', 'type:data', 'type:util'] },
            { sourceTag: 'type:data', onlyDependOnLibsWithTags: ['type:data', 'type:util'] },
            { sourceTag: 'type:util', onlyDependOnLibsWithTags: ['type:util'] },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
    // Override or add rules here
    rules: {},
  },
];
