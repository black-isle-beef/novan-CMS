import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import swc from 'unplugin-swc';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/api/common',
  // SWC replaces Vite's transformer so Nest decorators emit the metadata DI relies on.
  plugins: [nxViteTsPaths(), swc.vite({ tsconfigFile: './tsconfig.spec.json' })],
  test: {
    name: 'api-common',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/api/common',
      provider: 'v8' as const,
    },
  },
}));
