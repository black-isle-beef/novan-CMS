import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/novan-cli',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'novan-cli',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/tools/novan-cli',
      provider: 'v8' as const,
    },
  },
}));